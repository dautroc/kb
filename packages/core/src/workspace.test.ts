import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findWorkspaceRoot,
  loadWorkspace,
  parseWorkspaceConfig,
} from "./workspace.js";

const baseProjectConfig = (name: string) => `
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
`;

async function setupKbProject(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, ".kb"), { recursive: true });
  await mkdir(join(dir, "sources"), { recursive: true });
  await mkdir(join(dir, "wiki"), { recursive: true });
  await writeFile(
    join(dir, ".kb", "config.toml"),
    baseProjectConfig(name),
    "utf8",
  );
}

describe("parseWorkspaceConfig", () => {
  it("parses members array", () => {
    const config = parseWorkspaceConfig({
      workspace: { members: ["projects/*", "shared/*"] },
    });
    expect(config.workspace.members).toEqual(["projects/*", "shared/*"]);
  });

  it("throws if workspace.members is missing", () => {
    expect(() => parseWorkspaceConfig({ workspace: {} })).toThrow(/members/i);
  });
});

describe("findWorkspaceRoot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-workspace-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds .kbworkspace.toml in current directory", async () => {
    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      "[workspace]\nmembers = []\n",
      "utf8",
    );
    const root = await findWorkspaceRoot(tmpDir);
    expect(root).toBe(tmpDir);
  });

  it("walks up to find .kbworkspace.toml", async () => {
    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      "[workspace]\nmembers = []\n",
      "utf8",
    );
    const deepDir = join(tmpDir, "a", "b");
    await mkdir(deepDir, { recursive: true });
    const root = await findWorkspaceRoot(deepDir);
    expect(root).toBe(tmpDir);
  });

  it("returns null when no .kbworkspace.toml found", async () => {
    const root = await findWorkspaceRoot(tmpDir);
    expect(root).toBeNull();
  });
});

describe("loadWorkspace", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-workspace-load-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads workspace and discovers member projects", async () => {
    const projectsDir = join(tmpDir, "projects");
    await setupKbProject(join(projectsDir, "alpha"), "alpha");
    await setupKbProject(join(projectsDir, "beta"), "beta");

    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      '[workspace]\nmembers = ["projects/*"]\n',
      "utf8",
    );

    const ws = await loadWorkspace(tmpDir);
    expect(ws.root).toBe(tmpDir);
    expect(ws.members).toHaveLength(2);
    const names = ws.members.map((p) => p.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});
