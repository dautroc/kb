import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import type { LlmAdapter } from "./llm.js";
import { indexProject } from "./indexer.js";
import { queryWiki } from "./query.js";

const validConfig: KbConfig = {
  project: { name: "test-query", version: "0.1.0" },
  directories: { sources: "sources", wiki: "wiki" },
  llm: { provider: "anthropic", model: "claude-3-haiku-20240307" },
  dependencies: {},
};

function makeProject(root: string, name = "test-query"): Project {
  return {
    name,
    root,
    kbDir: join(root, ".kb"),
    sourcesDir: join(root, "sources"),
    wikiDir: join(root, "wiki"),
    config: { ...validConfig, project: { ...validConfig.project, name } },
  };
}

async function setupProject(root: string): Promise<Project> {
  const project = makeProject(root);
  await mkdir(project.kbDir, { recursive: true });
  await mkdir(project.wikiDir, { recursive: true });
  await mkdir(project.sourcesDir, { recursive: true });
  return project;
}

function makeMockLlm(answer: string): LlmAdapter {
  return {
    async complete(_messages, _systemPrompt) {
      return answer;
    },
  };
}

describe("queryWiki", () => {
  let tmpDir: string;
  let project: Project;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-query-test-"));
    project = await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns answer from LLM using retrieved pages as context", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Authentication Guide\ntags: [security]\n---\n\nUsers authenticate using JWT tokens.\n`,
      "utf8",
    );
    await indexProject(project);

    const llm = makeMockLlm("JWT tokens are used for auth. See [[auth]].");
    const result = await queryWiki(project, "authenticate JWT tokens", llm);

    expect(result.answer).toBe("JWT tokens are used for auth. See [[auth]].");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources).toContain("wiki/auth.md");
  });

  it("sources list matches the pages retrieved", async () => {
    await writeFile(
      join(project.wikiDir, "page-a.md"),
      `---\ntitle: Page A\n---\n\nContent about authentication tokens.\n`,
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page-b.md"),
      `---\ntitle: Page B\n---\n\nMore content about authentication.\n`,
      "utf8",
    );
    await indexProject(project);

    const capturedMessages: Array<{ role: string; content: string }> = [];
    const llm: LlmAdapter = {
      async complete(messages, _systemPrompt) {
        capturedMessages.push(...messages);
        return "Answer about authentication.";
      },
    };

    const result = await queryWiki(project, "authentication", llm);

    // Sources should only contain paths that appear in context
    for (const src of result.sources) {
      expect(capturedMessages[0].content).toContain(src);
    }
  });

  it("LLM prompt includes system prompt and question with page context", async () => {
    await writeFile(
      join(project.wikiDir, "concept.md"),
      `---\ntitle: Concept Overview\n---\n\nThis is a core concept explanation.\n`,
      "utf8",
    );
    await indexProject(project);

    let capturedSystem = "";
    let capturedUser = "";
    const llm: LlmAdapter = {
      async complete(messages, systemPrompt) {
        capturedSystem = systemPrompt;
        capturedUser = messages[0]?.content ?? "";
        return "Answer.";
      },
    };

    await queryWiki(project, "concept overview", llm);

    expect(capturedSystem).toContain("wiki pages");
    expect(capturedSystem).toContain("[[page-name]]");
    expect(capturedUser).toContain("concept overview");
    expect(capturedUser).toContain("Concept Overview");
  });

  it("empty search results — LLM still called with empty context", async () => {
    // No pages indexed — db doesn't exist yet, auto-index will find nothing
    let llmCalled = false;
    const llm: LlmAdapter = {
      async complete(_messages, _systemPrompt) {
        llmCalled = true;
        return "I don't have information about that.";
      },
    };

    const result = await queryWiki(project, "something with no results", llm);

    expect(llmCalled).toBe(true);
    expect(result.answer).toBe("I don't have information about that.");
    expect(result.sources).toHaveLength(0);
  });

  it("--save writes the answer to specified path", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Auth\n---\n\nAuth uses JWT.\n`,
      "utf8",
    );
    await indexProject(project);

    const llm = makeMockLlm("JWT is used for auth. See [[auth]].");
    const savePath = "wiki/summaries/auth-answer.md";

    const result = await queryWiki(project, "authenticate JWT", llm, {
      save: savePath,
    });

    expect(result.answer).toBe("JWT is used for auth. See [[auth]].");

    const savedContent = await readFile(join(project.root, savePath), "utf8");
    expect(savedContent).toContain("JWT is used for auth");
  });

  it("--save appends to log.md", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Auth\n---\n\nAuth uses JWT.\n`,
      "utf8",
    );
    await indexProject(project);

    const llm = makeMockLlm("JWT auth answer.");
    const savePath = "wiki/summaries/log-test.md";

    await queryWiki(project, "authenticate JWT tokens", llm, {
      save: savePath,
    });

    const logPath = join(project.wikiDir, "log.md");
    const logContent = await readFile(logPath, "utf8");
    expect(logContent).toContain("Queried:");
    expect(logContent).toContain("authenticate JWT tokens");
  });

  it("--save rejects path outside project root", async () => {
    const llm = makeMockLlm("Answer.");

    await expect(
      queryWiki(project, "question?", llm, {
        save: "../../evil.md",
      }),
    ).rejects.toThrow(/unsafe path/i);
  });
});
