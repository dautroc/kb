import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chunkPage, embedProject, OllamaUnavailableError } from "./embedder.js";
import type { ParsedPage } from "./markdown.js";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import { openDb, closeDb } from "./db.js";
import { indexProject } from "./indexer.js";

function makePage(content: string, path = "wiki/test.md"): ParsedPage {
  return {
    path,
    title: "Test Page",
    content,
    tags: "",
    frontmatter: {},
    outgoingLinks: [],
    outgoingCrossLinks: [],
    wordCount: content.split(/\s+/).length,
  };
}

describe("chunkPage", () => {
  it("returns single chunk for a small page with no headings", () => {
    const page = makePage("Short content here.");
    const chunks = chunkPage(page, 900, "abc123");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Short content here.");
    expect(chunks[0].page_sha256).toBe("abc123");
    expect(chunks[0].heading).toBe("");
  });

  it("splits page at heading boundaries", () => {
    const content = `Introduction text with more words here to make it longer and exceed the minimum.

## Section A

Content of section A with lots of additional text here to make sure we have at least twenty tokens for this chunk.

## Section B

Content of section B with more text added and additional content to pass token requirement for this section too.`;
    const page = makePage(content);
    const chunks = chunkPage(page, 900, "sha1");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const headings = chunks.map((c) => c.heading);
    expect(headings.some((h) => h.includes("Section A"))).toBe(true);
    expect(headings.some((h) => h.includes("Section B"))).toBe(true);
  });

  it("discards chunks with fewer than 20 tokens", () => {
    const content = `## Tiny

Hi.

## Big Section

${"word ".repeat(50)}`;
    const page = makePage(content);
    const chunks = chunkPage(page, 900, "sha2");
    expect(chunks.every((c) => c.token_count >= 20)).toBe(true);
  });

  it("splits oversized sections at paragraph boundaries", () => {
    const bigSection = Array.from(
      { length: 3 },
      (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(20)}`,
    ).join("\n\n");
    const content = `## Big\n\n${bigSection}`;
    const page = makePage(content);
    const chunks = chunkPage(page, 50, "sha3");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("includes page_path on every chunk", () => {
    const page = makePage(
      "Some content here with enough words to pass minimum threshold okay.",
      "wiki/my.md",
    );
    const chunks = chunkPage(page, 900, "sha4");
    expect(chunks.every((c) => c.page_path === "wiki/my.md")).toBe(true);
  });
});

const FAKE_EMBEDDING = new Array(768).fill(0.1);

function startMockOllama(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/embed") {
        let body = "";
        req.on("data", (d: Buffer) => {
          body += d;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body) as { input: string[] };
          const count = Array.isArray(parsed.input) ? parsed.input.length : 1;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ embeddings: Array(count).fill(FAKE_EMBEDDING) }),
          );
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

function makeConfig(ollamaPort: number): KbConfig {
  return {
    project: { name: "test-embed", version: "0.1.0" },
    directories: { sources: "sources", wiki: "wiki" },
    llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    dependencies: {},
    search: {
      embedding_provider: "ollama",
      embedding_model: "nomic-embed-text",
      ollama_url: `http://localhost:${ollamaPort}`,
      chunk_size: 900,
    },
  };
}

describe("embedProject", () => {
  let tmpDir: string;
  let project: Project;
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    const { server, port } = await startMockOllama();
    mockServer = server;
    mockPort = port;

    tmpDir = await mkdtemp(join(tmpdir(), "kb-embed-test-"));
    const kbDir = join(tmpDir, ".kb");
    const wikiDir = join(tmpDir, "wiki");
    await mkdir(kbDir, { recursive: true });
    await mkdir(wikiDir, { recursive: true });
    project = {
      name: "test-embed",
      root: tmpDir,
      kbDir,
      sourcesDir: join(tmpDir, "sources"),
      wikiDir,
      config: makeConfig(mockPort),
    };
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("embeds pages and writes chunks to DB", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Auth Guide\n---\n\n${"Authentication token flow. ".repeat(10)}\n`,
      "utf8",
    );
    await indexProject(project);

    const stats = await embedProject(project);
    expect(stats.embedded).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toBe(0);

    const db = openDb(project);
    try {
      const count = (
        db.prepare("SELECT count(*) as n FROM chunks").get() as { n: number }
      ).n;
      expect(count).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it("skips unchanged pages on second embed", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Test\n---\n\n${"word ".repeat(30)}\n`,
      "utf8",
    );
    await indexProject(project);
    await embedProject(project);

    const stats2 = await embedProject(project);
    expect(stats2.skipped).toBe(1);
    expect(stats2.embedded).toBe(0);
  });

  it("re-embeds pages when rebuild=true", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Test\n---\n\n${"word ".repeat(30)}\n`,
      "utf8",
    );
    await indexProject(project);
    await embedProject(project);

    const stats2 = await embedProject(project, { rebuild: true });
    expect(stats2.embedded).toBe(1);
    expect(stats2.skipped).toBe(0);
  });

  it("throws OllamaUnavailableError when Ollama is unreachable", async () => {
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Test\n---\n\n${"word ".repeat(30)}\n`,
      "utf8",
    );
    await indexProject(project);

    const badProject: Project = {
      ...project,
      config: {
        ...project.config,
        search: {
          ...project.config.search!,
          ollama_url: "http://localhost:19999",
        },
      },
    };
    await expect(embedProject(badProject)).rejects.toThrow(
      OllamaUnavailableError,
    );
  });
});
