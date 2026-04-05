// packages/core/src/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "./init.js";
import { loadProject } from "./project.js";
import { indexProject } from "./indexer.js";
import { openDb, closeDb } from "./db.js";
import { searchWiki } from "./search.js";
import { lintProject } from "./lint.js";

describe("full pipeline: init → index → search → lint", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-integration-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("init creates valid project structure loadable by loadProject", async () => {
    await initProject({ name: "integration-test", directory: tmpDir });
    const project = await loadProject(tmpDir);
    expect(project.name).toBe("integration-test");
    expect(project.root).toBe(tmpDir);
  });

  it("indexProject indexes wiki pages and search finds them", async () => {
    await initProject({ name: "search-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a wiki page
    await mkdir(join(project.wikiDir, "concepts"), { recursive: true });
    await writeFile(
      join(project.wikiDir, "concepts", "authentication.md"),
      [
        "---",
        "title: Authentication Overview",
        "tags: [security, auth]",
        "---",
        "",
        "# Authentication Overview",
        "",
        "Authentication is the process of verifying identity.",
        "JWT tokens are used for stateless authentication.",
        "The login flow validates credentials against the database.",
      ].join("\n"),
      "utf8",
    );

    const stats = await indexProject(project);
    expect(stats.indexed).toBeGreaterThan(0);
    expect(stats.errors).toBe(0);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "authentication JWT", project.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.title).toBe("Authentication Overview");
      expect(results[0]!.tags).toContain("security");
      expect(results[0]!.tags).toContain("auth");
    } finally {
      closeDb(db);
    }
  });

  it("indexProject is incremental — unchanged files are skipped", async () => {
    await initProject({ name: "incr-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    await writeFile(
      join(project.wikiDir, "page.md"),
      "# Page\n\nSome content here for testing.",
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBeGreaterThan(0);

    const second = await indexProject(project);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("lintProject detects ORPHAN_PAGE after indexing", async () => {
    await initProject({ name: "lint-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a page that nobody links to
    await writeFile(
      join(project.wikiDir, "orphan.md"),
      "# Orphaned Page\n\nThis page has no inbound links from other pages.",
      "utf8",
    );

    await indexProject(project);
    const result = await lintProject(project);
    const orphans = result.issues.filter((i) => i.code === "ORPHAN_PAGE");
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans.some((i) => i.path.includes("orphan.md"))).toBe(true);
  });

  it("lintProject detects BROKEN_LINK", async () => {
    await initProject({ name: "broken-link-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a page with a broken wikilink
    await writeFile(
      join(project.wikiDir, "page-with-broken-link.md"),
      "# Page\n\nSee [[nonexistent-page]] for more details.",
      "utf8",
    );

    await indexProject(project);
    const result = await lintProject(project);
    const broken = result.issues.filter((i) => i.code === "BROKEN_LINK");
    expect(broken.length).toBeGreaterThan(0);
  });

  it("search returns no results for empty wiki", async () => {
    await initProject({ name: "empty-test", directory: tmpDir });
    const project = await loadProject(tmpDir);
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "anything", project.name);
      expect(results).toHaveLength(0);
    } finally {
      closeDb(db);
    }
  });

  it("lintProject reports pagesChecked matching actual wiki page count", async () => {
    await initProject({ name: "count-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    await writeFile(
      join(project.wikiDir, "page1.md"),
      "# Page 1\n\nContent.",
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page2.md"),
      "# Page 2\n\nContent.",
      "utf8",
    );

    const result = await lintProject(project);
    // _index.md + page1.md + page2.md = 3
    expect(result.pagesChecked).toBe(3);
  });
});
