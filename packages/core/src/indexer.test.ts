import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import { indexProject } from "./indexer.js";
import { openDb, closeDb } from "./db.js";

const validConfig: KbConfig = {
  project: { name: "test", version: "0.1.0" },
  directories: { sources: "sources", wiki: "wiki" },
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  dependencies: {},
};

async function setupProject(dir: string): Promise<Project> {
  const kbDir = join(dir, ".kb");
  const wikiDir = join(dir, "wiki");
  const sourcesDir = join(dir, "sources");
  await mkdir(kbDir, { recursive: true });
  await mkdir(wikiDir, { recursive: true });
  await mkdir(sourcesDir, { recursive: true });

  return {
    name: "test",
    root: dir,
    kbDir,
    sourcesDir,
    wikiDir,
    config: validConfig,
  };
}

describe("indexProject", () => {
  let tmpDir: string;
  let project: Project;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-indexer-test-"));
    project = await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("indexes a directory with multiple markdown files and returns correct stats", async () => {
    await writeFile(
      join(project.wikiDir, "page-one.md"),
      `---\ntitle: Page One\ntags: [alpha]\n---\n\n# Page One\n\nContent of page one.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page-two.md"),
      `---\ntitle: Page Two\ntags: [beta]\n---\n\n# Page Two\n\nContent of page two. See [[page-one]].\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page-three.md"),
      `---\ntitle: Page Three\n---\n\nThird page content.\n`,
      "utf8",
    );

    const stats = await indexProject(project);
    expect(stats.indexed).toBe(3);
    expect(stats.skipped).toBe(0);
    expect(stats.deleted).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it("second run with no changes skips all files", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Stable Page\n---\n\nContent.\n`,
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBe(1);

    const second = await indexProject(project);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.deleted).toBe(0);
  });

  it("re-indexes a modified file", async () => {
    const filePath = join(project.wikiDir, "mutable.md");
    await writeFile(
      filePath,
      `---\ntitle: Original\n---\n\nOriginal content.\n`,
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBe(1);

    await writeFile(
      filePath,
      `---\ntitle: Updated\n---\n\nUpdated content.\n`,
      "utf8",
    );

    const second = await indexProject(project);
    expect(second.indexed).toBe(1);
    expect(second.skipped).toBe(0);

    // Verify updated title is in DB
    const db = openDb(project);
    const row = db
      .prepare<
        [string],
        { title: string }
      >("SELECT title FROM pages WHERE path = ?")
      .get("wiki/mutable.md");
    closeDb(db);
    expect(row?.title).toBe("Updated");
  });

  it("removes deleted files from the index", async () => {
    const filePath = join(project.wikiDir, "to-delete.md");
    await writeFile(
      filePath,
      `---\ntitle: Temp Page\n---\n\nWill be deleted.\n`,
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBe(1);

    await unlink(filePath);

    const second = await indexProject(project);
    expect(second.deleted).toBe(1);
    expect(second.indexed).toBe(0);

    const db = openDb(project);
    const row = db
      .prepare<
        [string],
        { path: string }
      >("SELECT path FROM page_meta WHERE path = ?")
      .get("wiki/to-delete.md");
    closeDb(db);
    expect(row).toBeUndefined();
  });

  it("correctly extracts frontmatter fields during indexing", async () => {
    await writeFile(
      join(project.wikiDir, "with-meta.md"),
      `---\ntitle: Meta Test\ntags: [one, two]\ncreated: 2026-01-01\n---\n\nSome content.\n`,
      "utf8",
    );

    await indexProject(project);

    const db = openDb(project);
    const pageRow = db
      .prepare<
        [string],
        { title: string; tags: string }
      >("SELECT title, tags FROM pages WHERE path = ?")
      .get("wiki/with-meta.md");
    const metaRow = db
      .prepare<
        [string],
        { frontmatter: string; word_count: number }
      >("SELECT frontmatter, word_count FROM page_meta WHERE path = ?")
      .get("wiki/with-meta.md");
    closeDb(db);

    expect(pageRow?.title).toBe("Meta Test");
    expect(pageRow?.tags).toBe("one,two");
    expect(metaRow?.word_count).toBeGreaterThan(0);
    const fm = JSON.parse(metaRow?.frontmatter ?? "{}") as Record<
      string,
      unknown
    >;
    // gray-matter parses ISO date strings as Date objects; JSON.stringify produces ISO string
    const createdVal = fm["created"];
    const createdStr =
      typeof createdVal === "string" ? createdVal.slice(0, 10) : createdVal;
    expect(createdStr).toBe("2026-01-01");
  });

  it("rebuild flag clears all existing entries before re-indexing", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Page\n---\n\nContent.\n`,
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBe(1);

    const rebuild = await indexProject(project, true);
    expect(rebuild.indexed).toBe(1);
    expect(rebuild.skipped).toBe(0);
  });
});
