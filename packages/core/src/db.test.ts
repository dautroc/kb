// packages/core/src/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { openDb, closeDb } from "./db.js";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";

function makeProject(root: string): Project {
  const config: KbConfig = {
    project: { name: "test", version: "0.1.0" },
    directories: { sources: "sources", wiki: "wiki" },
    llm: { provider: "anthropic", model: "claude-3" },
    dependencies: {},
  };
  return {
    name: "test",
    root,
    kbDir: join(root, ".kb"),
    sourcesDir: join(root, "sources"),
    wikiDir: join(root, "wiki"),
    config,
  };
}

describe("openDb", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-db-test-"));
    await mkdir(join(tmpDir, ".kb"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates index.db at .kb/index.db", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    expect(db).toBeDefined();
    closeDb(db);
    expect(existsSync(join(tmpDir, ".kb", "index.db"))).toBe(true);
  });

  it("creates the pages FTS5 virtual table", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pages'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("pages");
    closeDb(db);
  });

  it("creates the page_meta table with required columns", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const cols = db.prepare("PRAGMA table_info(page_meta)").all() as Array<{
      name: string;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("path");
    expect(colNames).toContain("sha256");
    expect(colNames).toContain("mtime");
    expect(colNames).toContain("word_count");
    expect(colNames).toContain("outgoing_links");
    closeDb(db);
  });

  it("is idempotent — calling openDb twice does not throw", () => {
    const project = makeProject(tmpDir);
    const db1 = openDb(project);
    closeDb(db1);
    const db2 = openDb(project);
    closeDb(db2);
  });

  it("enables WAL journal mode", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const row = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe("wal");
    closeDb(db);
  });
});

describe("closeDb", () => {
  it("closes the database connection", async () => {
    const tmpDir2 = await mkdtemp(join(tmpdir(), "kb-db-close-"));
    try {
      await mkdir(join(tmpDir2, ".kb"), { recursive: true });
      const project = makeProject(tmpDir2);
      const db = openDb(project);
      closeDb(db);
      expect(() => db.prepare("SELECT 1").get()).toThrow();
    } finally {
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
