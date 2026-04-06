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
  let globalConfigDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-test-"));
    globalConfigDir = await mkdtemp(join(tmpdir(), "kb-global-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(globalConfigDir, { recursive: true, force: true });
  });

  it("creates .kb/config.toml with given project name", async () => {
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

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
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    const schemaPath = join(tmpDir, ".kb", "schema.md");
    expect(await fileExists(schemaPath)).toBe(true);

    const content = await readFile(schemaPath, "utf8");
    expect(content).toContain("Wiki Structure");
    expect(content).toContain("[[page-name]]");
    expect(content).toContain("frontmatter");
  });

  it("creates sources/ directory with .gitkeep", async () => {
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    const gitkeepPath = join(tmpDir, "sources", ".gitkeep");
    expect(await fileExists(gitkeepPath)).toBe(true);
  });

  it("creates wiki/_index.md with project name and ISO date", async () => {
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    const indexPath = join(tmpDir, "wiki", "_index.md");
    expect(await fileExists(indexPath)).toBe(true);

    const content = await readFile(indexPath, "utf8");
    expect(content).toContain("my-project Knowledge Base");
    expect(content).toContain("title:");
    expect(content).toContain("created:");
  });

  it("creates log.md with initialization entry", async () => {
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    const logPath = join(tmpDir, "log.md");
    expect(await fileExists(logPath)).toBe(true);

    const content = await readFile(logPath, "utf8");
    expect(content).toContain("Activity Log");
    expect(content).toContain("Project initialized");
    expect(content).toContain("my-project");
  });

  it("throws if .kb/ already exists", async () => {
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    await expect(
      initProject({
        name: "my-project",
        directory: tmpDir,
        globalConfigPath: join(globalConfigDir, "config.toml"),
      }),
    ).rejects.toThrow("already initialized");
  });

  it("cleans up .kb/ on initialization failure", async () => {
    // Create a file named "wiki" to cause mkdir to fail
    await writeFile(join(tmpDir, "wiki"), "blocking file");

    await expect(
      initProject({
        name: "test",
        directory: tmpDir,
        globalConfigPath: join(globalConfigDir, "config.toml"),
      }),
    ).rejects.toThrow();

    // .kb/ should be removed on failure
    await expect(access(join(tmpDir, ".kb"))).rejects.toThrow();
  });

  it("uses directory basename as project name when name is empty string", async () => {
    // directory basename used when name is empty string (fallback logic)
    const dirName = tmpDir.split("/").pop()!;
    await initProject({
      name: "",
      directory: tmpDir,
      globalConfigPath: join(globalConfigDir, "config.toml"),
    });

    const configPath = join(tmpDir, ".kb", "config.toml");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain(`name = "${dirName}"`);
  });

  it("creates global config with defaults when it does not exist", async () => {
    const globalConfigPath = join(globalConfigDir, "config.toml");
    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath,
    });

    expect(await fileExists(globalConfigPath)).toBe(true);
    const content = await readFile(globalConfigPath, "utf8");
    expect(content).toContain('provider = "anthropic"');
    expect(content).toContain("claude-sonnet-4-20250514");
  });

  it("does not overwrite existing global config", async () => {
    const globalConfigPath = join(globalConfigDir, "config.toml");
    await writeFile(
      globalConfigPath,
      `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
      "utf8",
    );

    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath,
    });

    const content = await readFile(globalConfigPath, "utf8");
    expect(content).toContain('provider = "openai"');
  });

  it("seeds project config from existing global config", async () => {
    const globalConfigPath = join(globalConfigDir, "config.toml");
    await writeFile(
      globalConfigPath,
      `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n\n[directories]\nsources = "sources"\nwiki = "wiki"\n`,
      "utf8",
    );

    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath,
    });

    const configPath = join(tmpDir, ".kb", "config.toml");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain('provider = "openai"');
    expect(content).toContain('model = "gpt-4o"');
  });

  it("project name is always from init arg, not global", async () => {
    const globalConfigPath = join(globalConfigDir, "config.toml");
    await writeFile(
      globalConfigPath,
      `[project]\nname = "global-name"\nversion = "9.9.9"\n\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n`,
      "utf8",
    );

    await initProject({
      name: "my-project",
      directory: tmpDir,
      globalConfigPath,
    });

    const configPath = join(tmpDir, ".kb", "config.toml");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain('name = "my-project"');
    expect(content).toContain('version = "0.1.0"');
    expect(content).not.toContain("global-name");
    expect(content).not.toContain("9.9.9");
  });
});
