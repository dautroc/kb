import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolveDependencies, updateGitDep } from "./deps.js";
import { loadProject } from "./project.js";

const baseConfig = (name: string, deps = "") => `
[project]
name = "${name}"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
${deps}
`;

async function setupKbProject(
  dir: string,
  name: string,
  deps = "",
): Promise<void> {
  await mkdir(join(dir, ".kb"), { recursive: true });
  await mkdir(join(dir, "sources"), { recursive: true });
  await mkdir(join(dir, "wiki"), { recursive: true });
  await writeFile(
    join(dir, ".kb", "config.toml"),
    baseConfig(name, deps),
    "utf8",
  );
}

describe("updateGitDep", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-deps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws on depName containing a forward slash", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    await expect(updateGitDep(project, "evil/dep")).rejects.toThrow(
      /Invalid dependency name/,
    );
  });

  it("throws on depName containing a backslash", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    await expect(updateGitDep(project, "evil\\dep")).rejects.toThrow(
      /Invalid dependency name/,
    );
  });

  it("throws on depName containing double dot", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    await expect(updateGitDep(project, "../escape")).rejects.toThrow(
      /Invalid dependency name/,
    );
  });
});

describe("resolveDependencies", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-deps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when project has no dependencies", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    const deps = await resolveDependencies(project);
    expect(deps).toHaveLength(0);
    expect(project.dependencies).toEqual([]);
  });

  it("resolves a path dependency", async () => {
    const mainDir = join(tmpDir, "main");
    const depDir = join(tmpDir, "dep-a");
    await setupKbProject(
      mainDir,
      "main-project",
      `dep-a = { path = "../dep-a" }`,
    );
    await setupKbProject(depDir, "dep-a");

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);

    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("dep-a");
    expect(deps[0]!.project.name).toBe("dep-a");
    expect(deps[0]!.mode).toBe("readwrite");
  });

  it("respects readonly mode from config", async () => {
    const mainDir = join(tmpDir, "main");
    const depDir = join(tmpDir, "dep-a");
    await setupKbProject(
      mainDir,
      "main-project",
      `dep-a = { path = "../dep-a", mode = "readonly" }`,
    );
    await setupKbProject(depDir, "dep-a");

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);
    expect(deps[0]!.mode).toBe("readonly");
  });

  it("is idempotent — returns same array on repeated calls", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    const deps1 = await resolveDependencies(project);
    const deps2 = await resolveDependencies(project);
    expect(deps1).toBe(deps2);
  });

  it("detects dependency cycles", async () => {
    const aDir = join(tmpDir, "a");
    const bDir = join(tmpDir, "b");
    await setupKbProject(aDir, "project-a", `b = { path = "../b" }`);
    await setupKbProject(bDir, "project-b", `a = { path = "../a" }`);

    const project = await loadProject(aDir);
    await expect(resolveDependencies(project)).rejects.toThrow(/cycle/i);
  });

  it("handles diamond dependency without throwing", async () => {
    const aDir = join(tmpDir, "a");
    const bDir = join(tmpDir, "b");
    const cDir = join(tmpDir, "c");
    const sharedDir = join(tmpDir, "shared");
    await setupKbProject(sharedDir, "shared");
    await setupKbProject(bDir, "b", `shared = { path = "../shared" }`);
    await setupKbProject(cDir, "c", `shared = { path = "../shared" }`);
    await setupKbProject(
      aDir,
      "a",
      `b = { path = "../b" }\nc = { path = "../c" }`,
    );

    const project = await loadProject(aDir);
    const deps = await resolveDependencies(project);
    expect(deps).toHaveLength(2);
  });
});

describe("git dependency caching", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-git-deps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("clones a git dependency into .kb/cache/<name>/", async () => {
    // Create a local git repo to use as the "remote"
    const remoteDir = join(tmpDir, "remote-repo");
    await mkdir(join(remoteDir, ".kb"), { recursive: true });
    await mkdir(join(remoteDir, "sources"), { recursive: true });
    await mkdir(join(remoteDir, "wiki"), { recursive: true });
    await writeFile(
      join(remoteDir, ".kb", "config.toml"),
      baseConfig("remote-dep"),
      "utf8",
    );
    // Initialize as a git repo
    const execFileAsync = promisify(execFileCb);
    await execFileAsync("git", ["init"], { cwd: remoteDir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], {
      cwd: remoteDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], {
      cwd: remoteDir,
    });
    await execFileAsync("git", ["add", "."], { cwd: remoteDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: remoteDir });

    // Get the actual branch name (may be "main" or "master")
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: remoteDir },
    );
    const branch = stdout.trim();

    const mainDir = join(tmpDir, "main");
    await setupKbProject(
      mainDir,
      "main-project",
      `remote-dep = { git = "${remoteDir}", branch = "${branch}" }`,
    );

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);

    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("remote-dep");

    // The cache directory should exist with .git (sentinel)
    const cacheDir = join(mainDir, ".kb", "cache", "remote-dep");
    await expect(access(join(cacheDir, ".git"))).resolves.toBeUndefined();
  });

  it("does not re-clone if cache already exists (.git sentinel present)", async () => {
    const mainDir = join(tmpDir, "main2");
    await setupKbProject(
      mainDir,
      "main2",
      `cached-dep = { git = "https://invalid.example.com/repo.git", branch = "main" }`,
    );

    // Pre-create the cache with a .git sentinel to simulate a prior successful clone
    const cacheDir = join(mainDir, ".kb", "cache", "cached-dep");
    await mkdir(join(cacheDir, ".kb"), { recursive: true });
    await mkdir(join(cacheDir, "sources"), { recursive: true });
    await mkdir(join(cacheDir, "wiki"), { recursive: true });
    await mkdir(join(cacheDir, ".git"), { recursive: true }); // sentinel
    await writeFile(
      join(cacheDir, ".kb", "config.toml"),
      baseConfig("cached-dep"),
      "utf8",
    );

    const project = await loadProject(mainDir);
    // Should NOT attempt git clone (invalid URL would throw)
    const deps = await resolveDependencies(project);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("cached-dep");
  });
});
