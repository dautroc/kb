import { createHash } from "node:crypto";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import Database from "better-sqlite3";
import type { Project } from "./project.js";
import { parsePage } from "./markdown.js";
import { openDb, closeDb } from "./db.js";
import { embedProject, OllamaUnavailableError } from "./embedder.js";

export interface EmbedSummary {
  embedded: number;
  skipped: number;
  errors: number;
  ollamaUnavailable?: boolean;
}

export interface IndexStats {
  indexed: number;
  skipped: number;
  deleted: number;
  errors: number;
  embedStats?: EmbedSummary;
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface PageMetaRow {
  sha256: string;
}

interface UpsertStmts {
  deletePages: Database.Statement;
  insertPage: Database.Statement;
  upsertMeta: Database.Statement;
}

function upsertParsedPage(
  stmts: UpsertStmts,
  project: Project,
  page: Awaited<ReturnType<typeof parsePage>>,
  hash: string,
  mtime: number,
): void {
  stmts.deletePages.run(page.path);
  stmts.insertPage.run(
    page.path,
    page.title,
    page.content,
    page.tags,
    project.name,
  );
  stmts.upsertMeta.run(
    page.path,
    hash,
    mtime,
    page.wordCount,
    JSON.stringify(page.frontmatter),
    JSON.stringify(page.outgoingLinks),
    JSON.stringify(page.outgoingCrossLinks),
    Date.now(),
  );
}

export async function indexProject(
  project: Project,
  rebuild = false,
): Promise<IndexStats> {
  const db = openDb(project);
  try {
    if (rebuild) {
      db.exec("DELETE FROM pages; DELETE FROM page_meta;");
    }

    const files = await collectMdFiles(project.wikiDir);
    const stats: IndexStats = { indexed: 0, skipped: 0, deleted: 0, errors: 0 };

    const getMetaStmt = db.prepare<[string], PageMetaRow>(
      "SELECT sha256 FROM page_meta WHERE path = ?",
    );

    const upsertStmts: UpsertStmts = {
      deletePages: db.prepare("DELETE FROM pages WHERE path = ?"),
      insertPage: db.prepare(
        "INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)",
      ),
      upsertMeta: db.prepare(`
        INSERT INTO page_meta(path, sha256, mtime, word_count, frontmatter, outgoing_links, outgoing_cross_links, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          word_count = excluded.word_count,
          frontmatter = excluded.frontmatter,
          outgoing_links = excluded.outgoing_links,
          outgoing_cross_links = excluded.outgoing_cross_links,
          updated_at = excluded.updated_at
      `),
    };

    const deleteStalePages = db.prepare("DELETE FROM pages WHERE path = ?");
    const deleteStaleMeta = db.prepare("DELETE FROM page_meta WHERE path = ?");
    const listMetaStmt = db.prepare<[], { path: string }>(
      "SELECT path FROM page_meta",
    );

    const processFile = db.transaction(
      (
        page: Awaited<ReturnType<typeof parsePage>>,
        hash: string,
        mtime: number,
      ) => {
        upsertParsedPage(upsertStmts, project, page, hash, mtime);
      },
    );

    const onDiskPaths = new Set<string>();

    for (const absPath of files) {
      const relPath = relative(project.root, absPath);
      onDiskPaths.add(relPath);

      let raw: string;
      try {
        raw = await readFile(absPath, "utf8");
      } catch (err) {
        stats.errors++;
        continue;
      }

      const hash = sha256(raw);
      const existing = getMetaStmt.get(relPath);

      if (existing && existing.sha256 === hash) {
        stats.skipped++;
        continue;
      }

      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(absPath);
      } catch {
        stats.errors++;
        continue;
      }

      let page: Awaited<ReturnType<typeof parsePage>>;
      try {
        page = await parsePage(absPath, relPath, raw);
      } catch {
        stats.errors++;
        continue;
      }

      try {
        processFile(page, hash, Math.floor(fileStat.mtimeMs));
        stats.indexed++;
      } catch {
        stats.errors++;
      }
    }

    // Remove entries for deleted files
    const allMetaPaths = listMetaStmt.all().map((r) => r.path);

    const stalePaths = allMetaPaths.filter((p) => !onDiskPaths.has(p));

    const deleteStale = db.transaction((paths: string[]) => {
      for (const p of paths) {
        deleteStalePages.run(p);
        deleteStaleMeta.run(p);
      }
    });

    deleteStale(stalePaths);
    stats.deleted += stalePaths.length;

    // Embed pages after BM25 indexing (skip stale deletion phase)
    try {
      const es = await embedProject(project, { rebuild });
      stats.embedStats = {
        embedded: es.embedded,
        skipped: es.skipped,
        errors: es.errors,
      };
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        stats.embedStats = {
          embedded: 0,
          skipped: 0,
          errors: 0,
          ollamaUnavailable: true,
        };
      } else {
        throw err;
      }
    }

    return stats;
  } finally {
    closeDb(db);
  }
}
