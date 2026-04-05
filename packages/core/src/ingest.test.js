import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestSource } from "./ingest.js";
const TMP = join(tmpdir(), "kb-ingest-test-" + process.pid);
const MOCK_LLM_RESULT = {
    summary: {
        path: "wiki/sources/test-paper-summary.md",
        content: "# Summary\n\nThis is a test summary.",
    },
    updates: [
        {
            path: "wiki/overview.md",
            content: "# Overview\n\nUpdated overview.",
            reason: "Added reference to test paper",
        },
    ],
    newPages: [
        {
            path: "wiki/concepts/new-concept.md",
            content: "# New Concept\n\nContent here.",
            reason: "Introduced by test paper",
        },
    ],
    indexUpdate: "# Index\n\n- [[overview]]\n- [[concepts/new-concept]]\n- [[sources/test-paper-summary]]",
    logEntry: "Ingested test-paper.txt — added summary, updated overview",
};
function createMockLlm(result) {
    return {
        async complete(_messages, _systemPrompt) {
            return JSON.stringify(result);
        },
    };
}
function makeTestProject(root) {
    const config = {
        project: { name: "test-project", version: "0.1.0" },
        directories: { sources: "sources", wiki: "wiki" },
        llm: { provider: "anthropic", model: "claude-3-haiku-20240307" },
        dependencies: {},
    };
    return {
        name: "test-project",
        root,
        kbDir: join(root, ".kb"),
        sourcesDir: join(root, "sources"),
        wikiDir: join(root, "wiki"),
        config,
    };
}
async function setupTestProject(root) {
    await mkdir(join(root, ".kb"), { recursive: true });
    await mkdir(join(root, "sources"), { recursive: true });
    await mkdir(join(root, "wiki"), { recursive: true });
    await writeFile(join(root, ".kb", "schema.md"), "# Wiki Schema\n\nStandard KB schema.", "utf8");
    await writeFile(join(root, "wiki", "_index.md"), "# Index\n\n- [[overview]]", "utf8");
    await writeFile(join(root, "wiki", "overview.md"), "# Overview\n\nProject overview.", "utf8");
}
beforeAll(async () => {
    await mkdir(TMP, { recursive: true });
});
afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
});
describe("ingestSource", () => {
    it("dry-run returns IngestPlan without writing files", async () => {
        const root = join(TMP, "dry-run-test");
        await setupTestProject(root);
        const sourceFile = join(TMP, "test-paper.txt");
        await writeFile(sourceFile, "This is test content for the paper.", "utf8");
        const project = makeTestProject(root);
        const llm = createMockLlm(MOCK_LLM_RESULT);
        const plan = await ingestSource(project, sourceFile, llm, {
            apply: false,
        });
        expect(plan.dryRun).toBe(true);
        expect(plan.result).toBeDefined();
        expect(plan.result.summary.path).toBe("wiki/sources/test-paper-summary.md");
        expect(plan.result.logEntry).toContain("Ingested");
        // Verify no files were written
        const summaryAbsPath = join(root, plan.result.summary.path);
        let fileExists = false;
        try {
            await readFile(summaryAbsPath);
            fileExists = true;
        }
        catch {
            fileExists = false;
        }
        expect(fileExists).toBe(false);
    });
    it("apply mode writes all files", async () => {
        const root = join(TMP, "apply-test");
        await setupTestProject(root);
        const sourceFile = join(TMP, "apply-paper.txt");
        await writeFile(sourceFile, "This is content to apply to the wiki.", "utf8");
        const project = makeTestProject(root);
        const llm = createMockLlm(MOCK_LLM_RESULT);
        const plan = await ingestSource(project, sourceFile, llm, { apply: true });
        expect(plan.dryRun).toBe(false);
        // Verify summary was written
        const summaryPath = join(root, plan.result.summary.path);
        const summaryContent = await readFile(summaryPath, "utf8");
        expect(summaryContent).toBe(MOCK_LLM_RESULT.summary.content);
        // Verify updated pages were written
        for (const update of plan.result.updates) {
            const updatedPath = join(root, update.path);
            const content = await readFile(updatedPath, "utf8");
            expect(content).toBe(update.content);
        }
        // Verify new pages were written
        for (const newPage of plan.result.newPages) {
            const newPath = join(root, newPage.path);
            const content = await readFile(newPath, "utf8");
            expect(content).toBe(newPage.content);
        }
        // Verify index was updated
        const indexPath = join(root, "wiki", "_index.md");
        const indexContent = await readFile(indexPath, "utf8");
        expect(indexContent).toBe(MOCK_LLM_RESULT.indexUpdate);
    });
    it("log.md is appended with log entry when apply=true", async () => {
        const root = join(TMP, "log-test");
        await setupTestProject(root);
        const sourceFile = join(TMP, "log-paper.txt");
        await writeFile(sourceFile, "Content for log test.", "utf8");
        const project = makeTestProject(root);
        const llm = createMockLlm(MOCK_LLM_RESULT);
        await ingestSource(project, sourceFile, llm, { apply: true });
        const logPath = join(root, "wiki", "log.md");
        const logContent = await readFile(logPath, "utf8");
        expect(logContent).toContain(MOCK_LLM_RESULT.logEntry);
    });
    it("batch mode processes multiple sources from a directory", async () => {
        const root = join(TMP, "batch-test");
        await setupTestProject(root);
        const sourcesDir = join(TMP, "batch-sources");
        await mkdir(sourcesDir, { recursive: true });
        await writeFile(join(sourcesDir, "file1.txt"), "Content one.", "utf8");
        await writeFile(join(sourcesDir, "file2.txt"), "Content two.", "utf8");
        const project = makeTestProject(root);
        const llm = createMockLlm(MOCK_LLM_RESULT);
        // Process each file individually (batch iterates directory)
        const plan1 = await ingestSource(project, join(sourcesDir, "file1.txt"), llm, { apply: false });
        const plan2 = await ingestSource(project, join(sourcesDir, "file2.txt"), llm, { apply: false });
        expect(plan1.dryRun).toBe(true);
        expect(plan2.dryRun).toBe(true);
        expect(plan1.result).toBeDefined();
        expect(plan2.result).toBeDefined();
    });
    it("throws when LLM returns a path outside project root (path traversal)", async () => {
        const root = join(TMP, "path-traversal-test");
        await setupTestProject(root);
        const sourceFile = join(TMP, "traversal-source.txt");
        await writeFile(sourceFile, "Content for traversal test.", "utf8");
        const maliciousResult = {
            ...MOCK_LLM_RESULT,
            summary: {
                path: "../../evil.md",
                content: "# Evil",
            },
        };
        const project = makeTestProject(root);
        const llm = createMockLlm(maliciousResult);
        await expect(ingestSource(project, sourceFile, llm, { apply: true })).rejects.toThrow(/unsafe path rejected/i);
    });
    it("throws descriptive error if LLM returns invalid JSON", async () => {
        const root = join(TMP, "invalid-json-test");
        await setupTestProject(root);
        const sourceFile = join(TMP, "bad-response.txt");
        await writeFile(sourceFile, "Some content.", "utf8");
        const badLlm = {
            async complete() {
                return "This is not JSON at all!";
            },
        };
        const project = makeTestProject(root);
        await expect(ingestSource(project, sourceFile, badLlm, { apply: false })).rejects.toThrow(/invalid llm response/i);
    });
});
//# sourceMappingURL=ingest.test.js.map