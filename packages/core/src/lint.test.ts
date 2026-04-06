import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import { loadProject } from "./project.js";
import { openDb, closeDb } from "./db.js";
import { indexProject } from "./indexer.js";
import { lintProject } from "./lint.js";

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

describe("lintProject", () => {
  let tmpDir: string;
  let project: Project;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-lint-test-"));
    project = await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns no issues for an empty wiki", async () => {
    const result = await lintProject(project);
    expect(result.issues).toHaveLength(0);
    expect(result.pagesChecked).toBe(0);
  });

  it("returns ORPHAN_PAGE for a page with no inbound links", async () => {
    // Create _index.md that references both pages
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\n[[concepts/linked]]\n`,
      "utf8",
    );
    await mkdir(join(project.wikiDir, "concepts"), { recursive: true });
    // linked is referenced by _index, orphan has no inbound references from any page
    await writeFile(
      join(project.wikiDir, "concepts", "linked.md"),
      `# Linked\n\nThis page has many words so it is not a stub. Words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "concepts", "orphan.md"),
      `# Orphan\n\nThis page has many words so it is not a stub. Words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const orphanIssues = result.issues.filter((i) => i.code === "ORPHAN_PAGE");
    expect(orphanIssues.length).toBeGreaterThan(0);
    const paths = orphanIssues.map((i) => i.path);
    expect(paths.some((p) => p.includes("orphan.md"))).toBe(true);
    // linked is referenced by _index so should not be orphan
    expect(paths.some((p) => p.includes("linked.md"))).toBe(false);
  });

  it("does not flag _index.md as orphan", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\nMain index page.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const orphanIssues = result.issues.filter((i) => i.code === "ORPHAN_PAGE");
    expect(orphanIssues.every((i) => !i.path.endsWith("_index.md"))).toBe(true);
  });

  it("returns BROKEN_LINK for a page with a wikilink to a non-existent page", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\n[[page-with-broken-link]]\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page-with-broken-link.md"),
      `# Page\n\nThis references [[does-not-exist]] which is missing.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const brokenIssues = result.issues.filter((i) => i.code === "BROKEN_LINK");
    expect(brokenIssues.length).toBeGreaterThan(0);
    expect(
      brokenIssues.some(
        (i) =>
          i.path.includes("page-with-broken-link.md") &&
          i.detail?.includes("does-not-exist"),
      ),
    ).toBe(true);
  });

  it("returns STUB_PAGE for a page with no outbound links and word count < 50", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\n[[stub]]\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "stub.md"),
      `# Stub\n\nShort content.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const stubIssues = result.issues.filter((i) => i.code === "STUB_PAGE");
    expect(stubIssues.length).toBeGreaterThan(0);
    expect(stubIssues.some((i) => i.path.includes("stub.md"))).toBe(true);
  });

  it("does not flag _index.md as STUB_PAGE", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\nShort.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const stubIssues = result.issues.filter((i) => i.code === "STUB_PAGE");
    expect(stubIssues.every((i) => !i.path.endsWith("_index.md"))).toBe(true);
  });

  it("does not flag a page with many words as STUB_PAGE", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\n[[long-page]]\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "long-page.md"),
      `# Long Page\n\nThis page has many words. ${Array(50).fill("word").join(" ")}.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const stubIssues = result.issues.filter((i) => i.code === "STUB_PAGE");
    expect(stubIssues.every((i) => !i.path.includes("long-page.md"))).toBe(
      true,
    );
  });

  it("returns STALE_SUMMARY when source file is newer than its summary page", async () => {
    const sourcesDir = join(tmpDir, "sources");
    const summaryDir = join(project.wikiDir, "sources");
    await mkdir(summaryDir, { recursive: true });

    // Create source file
    const sourceFile = join(sourcesDir, "report.pdf");
    await writeFile(sourceFile, "source content", "utf8");

    // Create summary file with older mtime
    const summaryFile = join(summaryDir, "report-summary.md");
    await writeFile(
      summaryFile,
      `# Report Summary\n\nSummary content.\n`,
      "utf8",
    );

    // Set summary mtime to be in the past (1 hour ago)
    const pastTime = new Date(Date.now() - 3600 * 1000);
    await utimes(summaryFile, pastTime, pastTime);

    // Set source mtime to now (newer than summary)
    const nowTime = new Date();
    await utimes(sourceFile, nowTime, nowTime);

    // Index the project first
    const result = await lintProject(project);
    const staleIssues = result.issues.filter((i) => i.code === "STALE_SUMMARY");
    expect(staleIssues.length).toBeGreaterThan(0);
    expect(staleIssues.some((i) => i.path.includes("report-summary.md"))).toBe(
      true,
    );
  });

  it("returns MISSING_INDEX for a page not mentioned in _index.md", async () => {
    await writeFile(
      join(project.wikiDir, "_index.md"),
      `# Index\n\nOnly mentions [[mentioned-page]].\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "mentioned-page.md"),
      `# Mentioned\n\nThis is referenced in _index.md. Words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "unlisted-page.md"),
      `# Unlisted\n\nNot in index. Words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words words.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    const missingIndexIssues = result.issues.filter(
      (i) => i.code === "MISSING_INDEX",
    );
    expect(missingIndexIssues.length).toBeGreaterThan(0);
    expect(
      missingIndexIssues.some((i) => i.path.includes("unlisted-page.md")),
    ).toBe(true);
    expect(
      missingIndexIssues.every((i) => !i.path.includes("mentioned-page.md")),
    ).toBe(true);
  });

  it("reports pagesChecked accurately", async () => {
    await writeFile(join(project.wikiDir, "_index.md"), `# Index\n`, "utf8");
    await writeFile(
      join(project.wikiDir, "page-a.md"),
      `# A\n\nContent.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page-b.md"),
      `# B\n\nContent.\n`,
      "utf8",
    );

    const result = await lintProject(project);
    expect(result.pagesChecked).toBe(3);
  });
});

describe("cross-project link lint checks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-xlink-lint-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function setupProject(
    dir: string,
    name: string,
    deps = "",
  ): Promise<void> {
    await mkdir(join(dir, ".kb"), { recursive: true });
    await mkdir(join(dir, "sources"), { recursive: true });
    await mkdir(join(dir, "wiki"), { recursive: true });
    await writeFile(
      join(dir, ".kb", "config.toml"),
      `[project]\nname = "${name}"\nversion = "0.1.0"\n[directories]\nsources = "sources"\nwiki = "wiki"\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n[dependencies]\n${deps}`,
      "utf8",
    );
    await writeFile(join(dir, "wiki", "_index.md"), `# ${name}\n`, "utf8");
  }

  it("reports UNDECLARED_CROSS_LINK as error when dep is not in config", async () => {
    await setupProject(tmpDir, "main");
    await writeFile(
      join(tmpDir, "wiki", "page-a.md"),
      "# Page A\n\n[[kb://unknown-dep/wiki/foo]]\n",
      "utf8",
    );

    const project = await loadProject(tmpDir);
    // Index the project so page_meta has outgoing_cross_links populated
    const db = openDb(project);
    await indexProject(project, db);
    const result = await lintProject(project);
    closeDb(db);

    const issue = result.issues.find((i) => i.code === "UNDECLARED_CROSS_LINK");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("reports UNRESOLVABLE_CROSS_LINK as warning when dep declared but page missing", async () => {
    const depDir = join(tmpDir, "dep-a");
    await setupProject(depDir, "dep-a");
    await setupProject(tmpDir, "main", `dep-a = { path = "${depDir}" }`);
    await writeFile(
      join(tmpDir, "wiki", "page-a.md"),
      "# Page A\n\n[[kb://dep-a/wiki/nonexistent-page]]\n",
      "utf8",
    );

    const project = await loadProject(tmpDir);
    const db = openDb(project);
    await indexProject(project, db);
    const result = await lintProject(project);
    closeDb(db);

    const issue = result.issues.find(
      (i) => i.code === "UNRESOLVABLE_CROSS_LINK",
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });
});
