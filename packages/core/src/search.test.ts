import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import { indexProject } from "./indexer.js";
import { openDb, closeDb } from "./db.js";
import { searchWiki, searchAcrossProjects } from "./search.js";

const validConfig: KbConfig = {
  project: { name: "test-search", version: "0.1.0" },
  directories: { sources: "sources", wiki: "wiki" },
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  dependencies: {},
};

async function setupProject(
  dir: string,
  name = "test-search",
): Promise<Project> {
  const kbDir = join(dir, ".kb");
  const wikiDir = join(dir, "wiki");
  const sourcesDir = join(dir, "sources");
  await mkdir(kbDir, { recursive: true });
  await mkdir(wikiDir, { recursive: true });
  await mkdir(sourcesDir, { recursive: true });

  return {
    name,
    root: dir,
    kbDir,
    sourcesDir,
    wikiDir,
    config: { ...validConfig, project: { ...validConfig.project, name } },
  };
}

describe("searchWiki", () => {
  let tmpDir: string;
  let project: Project;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-search-test-"));
    project = await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("empty query returns no results", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Some Page\n---\n\nSome content here.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "", project.name);
      expect(results).toHaveLength(0);
    } finally {
      closeDb(db);
    }
  });

  it("query matches by content and returns results ranked by BM25", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Authentication Guide\ntags: [security]\n---\n\nUsers authenticate using JWT tokens. The flow begins with login.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "db.md"),
      `---\ntitle: Database Setup\ntags: [infra]\n---\n\nSetting up PostgreSQL for persistence.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "authenticate JWT", project.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("wiki/auth.md");
      expect(results[0].rank).toBeLessThan(0); // BM25 score is negative
    } finally {
      closeDb(db);
    }
  });

  it("query matches by title and returns correct result", async () => {
    await writeFile(
      join(project.wikiDir, "jwt.md"),
      `---\ntitle: JWT Tokens\ntags: [security]\n---\n\nJSON Web Tokens are used for stateless authentication.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "other.md"),
      `---\ntitle: Unrelated Topic\n---\n\nNothing to do with tokens.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "JWT Tokens", project.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe("JWT Tokens");
    } finally {
      closeDb(db);
    }
  });

  it("respects the limit option", async () => {
    for (let i = 1; i <= 5; i++) {
      await writeFile(
        join(project.wikiDir, `page-${i}.md`),
        `---\ntitle: Page ${i}\n---\n\nContent about authentication and tokens.\n`,
        "utf8",
      );
    }
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "authentication tokens", project.name, {
        limit: 3,
      });
      expect(results.length).toBeLessThanOrEqual(3);
    } finally {
      closeDb(db);
    }
  });

  it("tags filter returns only results matching ALL specified tags", async () => {
    await writeFile(
      join(project.wikiDir, "sec-api.md"),
      `---\ntitle: Secure API\ntags: [security, api]\n---\n\nSecure API endpoints with authentication.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "sec-only.md"),
      `---\ntitle: Security Guide\ntags: [security]\n---\n\nGeneral security guidelines and authentication best practices.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "api-only.md"),
      `---\ntitle: API Reference\ntags: [api]\n---\n\nAPI endpoint authentication documentation.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "authentication", project.name, {
        tags: ["security", "api"],
      });
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("wiki/sec-api.md");
    } finally {
      closeDb(db);
    }
  });

  it("project name filter returns only results from matching project", async () => {
    // Set up two projects sharing the same DB won't work naturally since each project
    // has its own DB. Instead, we manually insert a page with a different project name.
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: My Page\n---\n\nContent about authentication.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      // Insert a page with a different project name
      db.prepare(
        "INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)",
      ).run(
        "other/page.md",
        "Other Page",
        "Content about authentication tokens.",
        "",
        "other-project",
      );

      const results = searchWiki(db, "authentication", project.name);
      expect(results.every((r) => r.path !== "other/page.md")).toBe(true);

      const otherResults = searchWiki(db, "authentication", "other-project");
      expect(otherResults.some((r) => r.path === "other/page.md")).toBe(true);
    } finally {
      closeDb(db);
    }
  });

  it("tags are parsed from comma-separated string into array", async () => {
    await writeFile(
      join(project.wikiDir, "tagged.md"),
      `---\ntitle: Tagged Page\ntags: [alpha, beta, gamma]\n---\n\nContent with multiple tags.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "multiple tags", project.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tags).toEqual(["alpha", "beta", "gamma"]);
    } finally {
      closeDb(db);
    }
  });
});

describe("searchAcrossProjects", () => {
  function makeInMemoryDb(
    projectName: string,
    rows: Array<{ path: string; title: string; content: string }>,
  ) {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(
        path, title, content, tags, project, tokenize='porter unicode61'
      );
    `);
    const insert = db.prepare(
      "INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(row.path, row.title, row.content, "", projectName);
    }
    return db;
  }

  it("merges results from multiple DBs and prefixes dep paths", () => {
    const db1 = makeInMemoryDb("proj-a", [
      {
        path: "wiki/foo.md",
        title: "Foo Page",
        content: "authentication flow details",
      },
    ]);
    const db2 = makeInMemoryDb("proj-b", [
      {
        path: "wiki/bar.md",
        title: "Bar Page",
        content: "authentication token",
      },
    ]);

    const results = searchAcrossProjects(
      [
        { db: db1, projectName: "proj-a", prefix: undefined },
        { db: db2, projectName: "proj-b", prefix: "proj-b" },
      ],
      "authentication",
      { limit: 10 },
    );

    db1.close();
    db2.close();

    expect(results.length).toBeGreaterThan(0);
    const proj2Result = results.find((r) => r.project === "proj-b");
    expect(proj2Result).toBeDefined();
    expect(proj2Result!.path).toBe("proj-b: wiki/bar.md");
  });

  it("returns results from current project with no prefix", () => {
    const db = makeInMemoryDb("main", [
      { path: "wiki/main.md", title: "Main Page", content: "authentication" },
    ]);

    const results = searchAcrossProjects(
      [{ db, projectName: "main", prefix: undefined }],
      "authentication",
      { limit: 5 },
    );
    db.close();

    expect(results[0]!.project).toBeUndefined();
    expect(results[0]!.path).toBe("wiki/main.md");
  });
});
