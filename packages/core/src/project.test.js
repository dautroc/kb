import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProject, tryLoadProject } from "./project.js";
const validConfigToml = `
[project]
name = "test-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
`;
async function setupKbProject(dir) {
    await mkdir(join(dir, ".kb"), { recursive: true });
    await mkdir(join(dir, "sources"), { recursive: true });
    await mkdir(join(dir, "wiki"), { recursive: true });
    await writeFile(join(dir, ".kb", "config.toml"), validConfigToml, "utf8");
}
describe("loadProject", () => {
    let tmpDir;
    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "kb-project-test-"));
    });
    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });
    it("finds .kb/ in the current directory", async () => {
        await setupKbProject(tmpDir);
        const project = await loadProject(tmpDir);
        expect(project.name).toBe("test-project");
        expect(project.root).toBe(tmpDir);
        expect(project.kbDir).toBe(join(tmpDir, ".kb"));
        expect(project.sourcesDir).toBe(join(tmpDir, "sources"));
        expect(project.wikiDir).toBe(join(tmpDir, "wiki"));
        expect(project.config.project.name).toBe("test-project");
    });
    it("walks up parent directories to find .kb/", async () => {
        await setupKbProject(tmpDir);
        const deepDir = join(tmpDir, "a", "b", "c");
        await mkdir(deepDir, { recursive: true });
        const project = await loadProject(deepDir);
        expect(project.root).toBe(tmpDir);
        expect(project.name).toBe("test-project");
    });
    it("throws when no .kb/ found in any ancestor", async () => {
        await expect(loadProject(tmpDir)).rejects.toThrow(/no kb project found/i);
    });
    it("throws with helpful message mentioning kb init", async () => {
        await expect(loadProject(tmpDir)).rejects.toThrow(/kb init/i);
    });
    it("project model has correct absolute paths based on config directories", async () => {
        const customToml = `
[project]
name = "custom-project"
version = "1.0.0"

[directories]
sources = "my-sources"
wiki = "my-wiki"

[llm]
provider = "openai"
model = "gpt-4"

[dependencies]
`;
        await mkdir(join(tmpDir, ".kb"), { recursive: true });
        await writeFile(join(tmpDir, ".kb", "config.toml"), customToml, "utf8");
        const project = await loadProject(tmpDir);
        expect(project.sourcesDir).toBe(join(tmpDir, "my-sources"));
        expect(project.wikiDir).toBe(join(tmpDir, "my-wiki"));
    });
});
describe("tryLoadProject", () => {
    let tmpDir;
    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "kb-try-project-test-"));
    });
    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });
    it("returns the project when found", async () => {
        await setupKbProject(tmpDir);
        const project = await tryLoadProject(tmpDir);
        expect(project).not.toBeNull();
        expect(project.name).toBe("test-project");
    });
    it("returns null when no .kb/ found", async () => {
        const project = await tryLoadProject(tmpDir);
        expect(project).toBeNull();
    });
    it("returns null even when deep in directory tree with no .kb/", async () => {
        const deepDir = join(tmpDir, "x", "y", "z");
        await mkdir(deepDir, { recursive: true });
        const project = await tryLoadProject(deepDir);
        expect(project).toBeNull();
    });
    it("re-throws on config parse errors (not a not-found error)", async () => {
        await mkdir(join(tmpDir, ".kb"), { recursive: true });
        await writeFile(join(tmpDir, ".kb", "config.toml"), "this is not valid toml ::::", "utf8");
        await expect(tryLoadProject(tmpDir)).rejects.toThrow();
    });
});
//# sourceMappingURL=project.test.js.map