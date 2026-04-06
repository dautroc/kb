import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDependencies } from "./deps.js";
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
