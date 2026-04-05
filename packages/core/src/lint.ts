import { readdir, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import type { Project } from "./project.js";
import { openDb, closeDb } from "./db.js";
import { indexProject } from "./indexer.js";

export type LintSeverity = "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  path: string;
  message: string;
  detail?: string;
}

export interface LintResult {
  issues: LintIssue[];
  pagesChecked: number;
  sourcesChecked: number;
}

interface PageMetaRow {
  path: string;
  outgoing_links: string;
  word_count: number;
  mtime: number;
  updated_at: number;
}

async function collectMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return (
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        // parentPath added Node 21.4+; fall back to the pre-deprecation path property
        .map((e) => join((e as any).parentPath ?? (e as any).path, e.name))
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return (
      entries
        .filter((e) => e.isFile())
        // parentPath added Node 21.4+; fall back to the pre-deprecation path property
        .map((e) => join((e as any).parentPath ?? (e as any).path, e.name))
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
}

/**
 * Build a set of "keys" for wiki pages for wikilink resolution.
 * A wikilink [[foo-bar]] can match:
 *   - a page whose filename (without extension) is "foo-bar"
 *   - a page whose relative path is "foo-bar" or "foo-bar.md"
 */
function buildPageKeySet(
  relPaths: string[],
  projectRoot: string,
  wikiDir: string,
): Set<string> {
  const keys = new Set<string>();
  for (const rp of relPaths) {
    // rp is relative to projectRoot, e.g. "wiki/concepts/foo.md"
    keys.add(rp);
    // without extension
    keys.add(rp.replace(/\.md$/i, ""));
    // filename without extension
    const fname = basename(rp, ".md");
    keys.add(fname);
    // relative path from wikiDir
    const absPath = join(projectRoot, rp);
    const relToWiki = relative(wikiDir, absPath);
    keys.add(relToWiki);
    keys.add(relToWiki.replace(/\.md$/i, ""));
  }
  return keys;
}

export async function lintProject(project: Project): Promise<LintResult> {
  // Ensure index is up to date
  await indexProject(project);

  const issues: LintIssue[] = [];

  // Collect all wiki md files
  const absWikiFiles = await collectMdFiles(project.wikiDir);
  const relWikiPaths = absWikiFiles.map((f) => relative(project.root, f));

  const pagesChecked = relWikiPaths.length;

  if (pagesChecked === 0) {
    return { issues, pagesChecked: 0, sourcesChecked: 0 };
  }

  // Build page key set for wikilink resolution
  const pageKeySet = buildPageKeySet(
    relWikiPaths,
    project.root,
    project.wikiDir,
  );

  // Query all page_meta rows
  const db = openDb(project);
  let rows: PageMetaRow[];
  try {
    rows = db
      .prepare<
        [],
        PageMetaRow
      >("SELECT path, outgoing_links, word_count, mtime, updated_at FROM page_meta")
      .all();
  } finally {
    closeDb(db);
  }

  // Build a map from path -> row for quick lookup
  const metaMap = new Map<string, PageMetaRow>();
  for (const row of rows) {
    metaMap.set(row.path, row);
  }

  // Build inbound link map
  const inboundLinks = new Map<string, Set<string>>();
  for (const rp of relWikiPaths) {
    inboundLinks.set(rp, new Set());
  }

  for (const row of rows) {
    let links: string[] = [];
    try {
      links = JSON.parse(row.outgoing_links) as string[];
    } catch {
      links = [];
    }
    for (const link of links) {
      // Find which page this link resolves to
      const resolved = resolveLink(
        link,
        relWikiPaths,
        project.root,
        project.wikiDir,
      );
      if (resolved !== null) {
        const set = inboundLinks.get(resolved);
        if (set) {
          set.add(row.path);
        }
      }
    }
  }

  // Read _index.md outgoing links for MISSING_INDEX check
  const indexPath = relWikiPaths.find((p) => basename(p) === "_index.md");
  let indexLinks: Set<string> = new Set();
  if (indexPath) {
    const indexRow = metaMap.get(indexPath);
    if (indexRow) {
      let links: string[] = [];
      try {
        links = JSON.parse(indexRow.outgoing_links) as string[];
      } catch {
        links = [];
      }
      for (const link of links) {
        const resolved = resolveLink(
          link,
          relWikiPaths,
          project.root,
          project.wikiDir,
        );
        if (resolved !== null) {
          indexLinks.add(resolved);
        }
        // Also store raw link for fuzzy matching
        indexLinks.add(link);
      }
    }
  }

  // --- CHECK 1: ORPHAN_PAGE ---
  for (const rp of relWikiPaths) {
    if (basename(rp) === "_index.md") continue;
    const inbound = inboundLinks.get(rp);
    if (!inbound || inbound.size === 0) {
      issues.push({
        severity: "warning",
        code: "ORPHAN_PAGE",
        path: rp,
        message: "Orphan page (no inbound links)",
      });
    }
  }

  // --- CHECK 2: BROKEN_LINK ---
  for (const row of rows) {
    let links: string[] = [];
    try {
      links = JSON.parse(row.outgoing_links) as string[];
    } catch {
      links = [];
    }
    for (const link of links) {
      if (!isLinkResolvable(link, pageKeySet)) {
        issues.push({
          severity: "warning",
          code: "BROKEN_LINK",
          path: row.path,
          message: `Broken wikilink [[${link}]] not found`,
          detail: link,
        });
      }
    }
  }

  // --- CHECK 3: STUB_PAGE ---
  for (const row of rows) {
    let links: string[] = [];
    try {
      links = JSON.parse(row.outgoing_links) as string[];
    } catch {
      links = [];
    }
    if (links.length === 0 && row.word_count < 50) {
      issues.push({
        severity: "info",
        code: "STUB_PAGE",
        path: row.path,
        message: `Stub page (no links, < 50 words)`,
      });
    }
  }

  // --- CHECK 4: STALE_SUMMARY ---
  // wiki/sources/foo-summary.md <-> sources/foo.*
  const wikiSourcesDir = join(project.wikiDir, "sources");
  const absSourceFiles = await collectSourceFiles(project.sourcesDir);
  const sourcesChecked = absSourceFiles.length;

  for (const rp of relWikiPaths) {
    // Check if the path is under wiki/sources/
    const absWikiPage = join(project.root, rp);
    const relToWikiSources = relative(wikiSourcesDir, absWikiPage);

    // Skip if not under wiki/sources/ (would start with "..")
    if (relToWikiSources.startsWith("..")) continue;

    // Convention: wiki/sources/foo-summary.md <-> sources/foo.*
    const summaryBasename = basename(rp, ".md");
    // Strip -summary suffix
    const sourceBasename = summaryBasename.endsWith("-summary")
      ? summaryBasename.slice(0, -"-summary".length)
      : summaryBasename;

    // Find matching source file
    const matchingSource = absSourceFiles.find((sf) => {
      const sfBase = basename(sf, extname(sf));
      return sfBase === sourceBasename;
    });

    if (!matchingSource) continue;

    try {
      const [sourceStat] = await Promise.all([stat(matchingSource)]);
      const summaryRow = metaMap.get(rp);
      if (!summaryRow) continue;

      // mtime is the file's modification time in ms stored at index time
      if (sourceStat.mtimeMs > summaryRow.mtime) {
        issues.push({
          severity: "warning",
          code: "STALE_SUMMARY",
          path: rp,
          message: "Source updated after summary",
          detail: relative(project.root, matchingSource),
        });
      }
    } catch {
      // Ignore stat errors
    }
  }

  // --- CHECK 5: MISSING_INDEX ---
  for (const rp of relWikiPaths) {
    if (basename(rp) === "_index.md") continue;
    if (!indexPath) {
      // No _index.md exists — skip this check
      continue;
    }
    if (!indexLinks.has(rp)) {
      // Check by filename too
      const fname = basename(rp, ".md");
      if (!indexLinks.has(fname)) {
        issues.push({
          severity: "info",
          code: "MISSING_INDEX",
          path: rp,
          message: "Not in _index.md",
        });
      }
    }
  }

  return { issues, pagesChecked, sourcesChecked };
}

function resolveLink(
  link: string,
  relPaths: string[],
  projectRoot: string,
  wikiDir: string,
): string | null {
  for (const rp of relPaths) {
    const fname = basename(rp, ".md");
    if (fname === link) return rp;
    if (rp === link || rp === `${link}.md`) return rp;
    // relative to wikiDir
    const absPath = join(projectRoot, rp);
    const relToWiki = relative(wikiDir, absPath);
    if (relToWiki === link || relToWiki.replace(/\.md$/i, "") === link) {
      return rp;
    }
  }
  return null;
}

function isLinkResolvable(link: string, pageKeySet: Set<string>): boolean {
  return pageKeySet.has(link);
}
