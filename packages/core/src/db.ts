import Database from "better-sqlite3";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Project } from "./project.js";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sqliteVec = _require("sqlite-vec") as { load: (db: unknown) => void };

const SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(
  path,
  title,
  content,
  tags,
  project,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS page_meta (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  frontmatter TEXT NOT NULL DEFAULT '{}',
  outgoing_links TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY,
  page_path    TEXT    NOT NULL,
  heading      TEXT    NOT NULL DEFAULT '',
  content      TEXT    NOT NULL,
  token_count  INTEGER NOT NULL DEFAULT 0,
  page_sha256  TEXT    NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  embedding float[768]
);
`;

function migrateDb(db: Database.Database): void {
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(page_meta)")
    .all()
    .map((c) => c.name);

  if (!columns.includes("outgoing_cross_links")) {
    db.exec(
      "ALTER TABLE page_meta ADD COLUMN outgoing_cross_links TEXT NOT NULL DEFAULT '[]'",
    );
  }
}

export function openDb(project: Project): Database.Database {
  const dbPath = join(project.kbDir, "index.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db);
  db.exec(SCHEMA_SQL);
  migrateDb(db);
  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}
