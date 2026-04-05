import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "./init.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("initProject", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .kb/config.toml with given project name", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    const configPath = join(tmpDir, ".kb", "config.toml");
    expect(await fileExists(configPath)).toBe(true);

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('name = "my-project"');
    expect(content).toContain('version = "0.1.0"');
    expect(content).toContain('sources = "sources"');
    expect(content).toContain('wiki = "wiki"');
    expect(content).toContain('provider = "anthropic"');
    expect(content).toContain("claude-sonnet-4-20250514");
  });

  it("creates .kb/schema.md", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    const schemaPath = join(tmpDir, ".kb", "schema.md");
    expect(await fileExists(schemaPath)).toBe(true);

    const content = await readFile(schemaPath, "utf8");
    expect(content).toContain("Wiki Structure");
    expect(content).toContain("[[page-name]]");
    expect(content).toContain("frontmatter");
  });

  it("creates sources/ directory with .gitkeep", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    const gitkeepPath = join(tmpDir, "sources", ".gitkeep");
    expect(await fileExists(gitkeepPath)).toBe(true);
  });

  it("creates wiki/_index.md with project name and ISO date", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    const indexPath = join(tmpDir, "wiki", "_index.md");
    expect(await fileExists(indexPath)).toBe(true);

    const content = await readFile(indexPath, "utf8");
    expect(content).toContain("my-project Knowledge Base");
    expect(content).toContain("title:");
    expect(content).toContain("created:");
  });

  it("creates log.md with initialization entry", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    const logPath = join(tmpDir, "log.md");
    expect(await fileExists(logPath)).toBe(true);

    const content = await readFile(logPath, "utf8");
    expect(content).toContain("Activity Log");
    expect(content).toContain("Project initialized");
    expect(content).toContain("my-project");
  });

  it("throws if .kb/ already exists", async () => {
    await initProject({ name: "my-project", directory: tmpDir });

    await expect(
      initProject({ name: "my-project", directory: tmpDir }),
    ).rejects.toThrow("already initialized");
  });

  it("cleans up .kb/ on initialization failure", async () => {
    // Create a file named "wiki" to cause mkdir to fail
    await writeFile(join(tmpDir, "wiki"), "blocking file");

    await expect(
      initProject({ name: "test", directory: tmpDir }),
    ).rejects.toThrow();

    // .kb/ should be removed on failure
    await expect(access(join(tmpDir, ".kb"))).rejects.toThrow();
  });

  it("uses directory basename as project name when name is empty string", async () => {
    // directory basename used when name is empty string (fallback logic)
    const dirName = tmpDir.split("/").pop()!;
    await initProject({ name: "", directory: tmpDir });

    const configPath = join(tmpDir, ".kb", "config.toml");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain(`name = "${dirName}"`);
  });
});
