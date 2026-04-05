import { createHash } from "node:crypto";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import Database from "better-sqlite3";
import type { Project } from "./project.js";
import { parsePage } from "./markdown.js";
import { openDb, closeDb } from "./db.js";

export interface IndexStats {
  indexed: number;
  skipped: number;
  deleted: number;
  errors: number;
}

async function collectMdFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface PageMetaRow {
  sha256: string;
}

function upsertParsedPage(
  db: Database.Database,
  project: Project,
  page: Awaited<ReturnType<typeof parsePage>>,
  hash: string,
  mtime: number,
): void {
  const deleteStmt = db.prepare("DELETE FROM pages WHERE path = ?");
  const insertStmt = db.prepare(
    "INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)",
  );
  const upsertMeta = db.prepare(`
    INSERT INTO page_meta(path, sha256, mtime, word_count, frontmatter, outgoing_links, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      sha256 = excluded.sha256,
      mtime = excluded.mtime,
      word_count = excluded.word_count,
      frontmatter = excluded.frontmatter,
      outgoing_links = excluded.outgoing_links,
      updated_at = excluded.updated_at
  `);

  deleteStmt.run(page.path);
  insertStmt.run(page.path, page.title, page.content, page.tags, project.name);
  upsertMeta.run(
    page.path,
    hash,
    mtime,
    page.wordCount,
    JSON.stringify(page.frontmatter),
    JSON.stringify(page.outgoingLinks),
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

    const processFile = db.transaction(
      (
        relPath: string,
        page: Awaited<ReturnType<typeof parsePage>>,
        hash: string,
        mtime: number,
      ) => {
        upsertParsedPage(db, project, page, hash, mtime);
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
        page = await parsePage(absPath, relPath);
      } catch {
        stats.errors++;
        continue;
      }

      try {
        processFile(relPath, page, hash, fileStat.mtimeMs);
        stats.indexed++;
      } catch {
        stats.errors++;
      }
    }

    // Remove entries for deleted files
    const allMetaPaths = db
      .prepare<[], { path: string }>("SELECT path FROM page_meta")
      .all()
      .map((r) => r.path);

    const deletePageStmt = db.prepare("DELETE FROM pages WHERE path = ?");
    const deleteMetaStmt = db.prepare("DELETE FROM page_meta WHERE path = ?");

    for (const p of allMetaPaths) {
      if (!onDiskPaths.has(p)) {
        deletePageStmt.run(p);
        deleteMetaStmt.run(p);
        stats.deleted++;
      }
    }

    return stats;
  } finally {
    closeDb(db);
  }
}
