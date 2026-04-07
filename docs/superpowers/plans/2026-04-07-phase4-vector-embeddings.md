# Phase 4: Hybrid Search with Vector Embeddings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic/hybrid search to `kb` by embedding wiki chunks via Ollama (sqlite-vec storage), with transparent RRF-merged results and graceful BM25 fallback.

**Architecture:** New `embedder.ts` chunks pages and writes vectors; new `vector-search.ts` embeds queries and runs KNN; `search.ts` becomes async and merges results via RRF. All three new capabilities integrate into the existing BM25 pipeline with no breaking changes when Ollama is absent.

**Tech Stack:** `sqlite-vec` (npm package), Ollama `/api/embed` HTTP endpoint, `nomic-embed-text` model (768-dim), Vitest for tests, `node:http` mock server for Ollama tests.

**Working directory:** `/Users/loi/workspace/kb/.worktrees/main/`

**Run commands with:** `COREPACK_ENABLE_STRICT=0 pnpm` (worktree-level corepack override required)

---

### Task 1: `[search]` config section in `config.ts`

**Files:**

- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`

- [ ] **Step 1: Read the current config files**

Read `packages/core/src/config.ts` and `packages/core/src/config.test.ts` in full before editing.

- [ ] **Step 2: Write the failing tests**

Add to `packages/core/src/config.test.ts`:

```typescript
describe("[search] config section", () => {
  it("applies defaults when [search] is absent", () => {
    const toml = `
[project]
name = "test"
version = "0.1.0"
[directories]
sources = "sources"
wiki = "wiki"
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`.trim();
    const config = parseConfig(toml);
    expect(config.search).toEqual({
      embedding_provider: "ollama",
      embedding_model: "nomic-embed-text",
      ollama_url: "http://localhost:11434",
      chunk_size: 900,
    });
  });

  it("parses explicit [search] values from TOML", () => {
    const toml = `
[project]
name = "test"
version = "0.1.0"
[directories]
sources = "sources"
wiki = "wiki"
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
[search]
embedding_provider = "ollama"
embedding_model = "mxbai-embed-large"
ollama_url = "http://remote:11434"
chunk_size = 500
`.trim();
    const config = parseConfig(toml);
    expect(config.search?.embedding_model).toBe("mxbai-embed-large");
    expect(config.search?.ollama_url).toBe("http://remote:11434");
    expect(config.search?.chunk_size).toBe(500);
  });
});
```

- [ ] **Step 3: Run failing test**

```bash
cd /Users/loi/workspace/kb/.worktrees/main
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run config
```

Expected: FAIL (property `search` doesn't exist).

- [ ] **Step 4: Add `SearchConfig` type and update `KbConfig`**

In `packages/core/src/config.ts`, add the type and update `KbConfig`:

```typescript
export interface SearchConfig {
  embedding_provider: "ollama";
  embedding_model: string;
  ollama_url: string;
  chunk_size: number;
}
```

Add to `KbConfig`:

```typescript
search?: SearchConfig;
```

- [ ] **Step 5: Parse `[search]` in `parseTomlFields()` and apply defaults in `mergeConfigs()`**

In `parseTomlFields()`, after parsing `[llm]`:

```typescript
// Parse [search] section if present
const rawSearch = parsed.search as Record<string, unknown> | undefined;
if (rawSearch) {
  partial.search = {
    embedding_provider: (rawSearch.embedding_provider as "ollama") ?? "ollama",
    embedding_model:
      (rawSearch.embedding_model as string) ?? "nomic-embed-text",
    ollama_url: (rawSearch.ollama_url as string) ?? "http://localhost:11434",
    chunk_size: (rawSearch.chunk_size as number) ?? 900,
  };
}
```

In `mergeConfigs()`, after merging other fields:

```typescript
search: override.search ?? base.search ?? {
  embedding_provider: "ollama",
  embedding_model: "nomic-embed-text",
  ollama_url: "http://localhost:11434",
  chunk_size: 900,
},
```

- [ ] **Step 6: Run tests and verify pass**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run config
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/loi/workspace/kb/.worktrees/main
git add packages/core/src/config.ts packages/core/src/config.test.ts
git commit -m "feat(core): add [search] config section with Ollama defaults"
```

---

### Task 2: sqlite-vec install + `chunks`/`chunks_vec` DB tables

**Files:**

- Modify: `packages/core/package.json`
- Modify: `packages/core/src/db.ts`
- Modify: `packages/core/src/db.test.ts`

- [ ] **Step 1: Read current files**

Read `packages/core/src/db.ts` and `packages/core/src/db.test.ts`.

- [ ] **Step 2: Install sqlite-vec**

```bash
cd /Users/loi/workspace/kb/.worktrees/main
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core add sqlite-vec
```

- [ ] **Step 3: Write failing DB tests**

Add to `packages/core/src/db.test.ts`:

```typescript
import { createRequire } from "node:module";

describe("sqlite-vec integration", () => {
  it("chunks table is created by openDb()", () => {
    // create a temp project and open its DB
    // (reuse tmpDir/project pattern from existing tests)
    const db = openDb(project);
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name);
      expect(tables).toContain("chunks");
    } finally {
      closeDb(db);
    }
  });

  it("chunks_vec virtual table is created by openDb()", () => {
    const db = openDb(project);
    try {
      const vtables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name);
      expect(vtables).toContain("chunks_vec");
    } finally {
      closeDb(db);
    }
  });
});
```

- [ ] **Step 4: Run failing tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run db
```

Expected: FAIL (`chunks` / `chunks_vec` tables missing).

- [ ] **Step 5: Load sqlite-vec and add schema in `db.ts`**

At the top of `packages/core/src/db.ts`, add the import using `createRequire` (required because `sqlite-vec` is CJS):

```typescript
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import * as sqliteVec from "sqlite-vec";
```

Add to the schema SQL (after existing tables):

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY,
  page_path    TEXT    NOT NULL,
  heading      TEXT    NOT NULL DEFAULT '',
  content      TEXT    NOT NULL,
  token_count  INTEGER NOT NULL DEFAULT 0,
  page_sha256  TEXT    NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  embedding float[768]
);
```

In `openDb()`, call `sqliteVec.load(db)` BEFORE the schema exec:

```typescript
export function openDb(project: Project): Database.Database {
  const dbPath = join(project.kbDir, "index.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db); // load sqlite-vec extension first
  db.exec(SCHEMA_SQL); // then create tables (chunks_vec needs vec0)
  return db;
}
```

- [ ] **Step 6: Build and run tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core build
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run db
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/db.ts packages/core/src/db.test.ts pnpm-lock.yaml
git commit -m "feat(core): add sqlite-vec, chunks/chunks_vec tables to DB schema"
```

---

### Task 3: `chunkPage()` pure function in `embedder.ts`

**Files:**

- Create: `packages/core/src/embedder.ts`
- Create: `packages/core/src/embedder.test.ts`

- [ ] **Step 1: Write failing tests for `chunkPage`**

Create `packages/core/src/embedder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chunkPage } from "./embedder.js";
import type { ParsedPage } from "./markdown.js";

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
    const content = `Introduction text.

## Section A

Content of section A.

## Section B

Content of section B.`;
    const page = makePage(content);
    const chunks = chunkPage(page, 900, "sha1");
    // Should produce at least 2 chunks (one per heading section)
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
    // "Hi." is < 20 tokens, should be discarded
    expect(chunks.every((c) => c.token_count >= 20)).toBe(true);
  });

  it("splits oversized sections at paragraph boundaries", () => {
    // Create a section with enough words to exceed chunk_size=50
    const bigSection = Array.from(
      { length: 3 },
      (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(20)}`,
    ).join("\n\n");
    const content = `## Big\n\n${bigSection}`;
    const page = makePage(content);
    const chunks = chunkPage(page, 50, "sha3"); // small chunk_size to force split
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
```

- [ ] **Step 2: Run failing tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run embedder
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `chunkPage` in `embedder.ts`**

Create `packages/core/src/embedder.ts`:

```typescript
import type { ParsedPage } from "./markdown.js";

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export interface Chunk {
  page_path: string;
  heading: string;
  content: string;
  token_count: number;
  page_sha256: string;
}

export interface EmbedStats {
  embedded: number;
  skipped: number;
  errors: number;
}

const MIN_TOKENS = 20;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function splitAtParagraphs(
  text: string,
  chunkSize: number,
  heading: string,
  path: string,
  sha: string,
): Chunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (estimateTokens(candidate) > chunkSize && buffer) {
      const tc = estimateTokens(buffer);
      if (tc >= MIN_TOKENS) {
        chunks.push({
          page_path: path,
          heading,
          content: buffer.trim(),
          token_count: tc,
          page_sha256: sha,
        });
      }
      buffer = para;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) {
    const tc = estimateTokens(buffer);
    if (tc >= MIN_TOKENS) {
      chunks.push({
        page_path: path,
        heading,
        content: buffer.trim(),
        token_count: tc,
        page_sha256: sha,
      });
    }
  }
  return chunks;
}

export function chunkPage(
  page: ParsedPage,
  chunkSize: number,
  pageSha256 = "",
): Chunk[] {
  const lines = page.content.split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,6})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.some((l) => l.trim())) {
        sections.push({ heading: currentHeading, lines: [...currentLines] });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some((l) => l.trim())) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  // If no headings found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({ heading: "", lines: lines });
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) continue;
    if (estimateTokens(text) <= chunkSize) {
      const tc = estimateTokens(text);
      if (tc >= MIN_TOKENS) {
        chunks.push({
          page_path: page.path,
          heading: section.heading,
          content: text,
          token_count: tc,
          page_sha256: pageSha256,
        });
      }
    } else {
      chunks.push(
        ...splitAtParagraphs(
          text,
          chunkSize,
          section.heading,
          page.path,
          pageSha256,
        ),
      );
    }
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run embedder
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/embedder.ts packages/core/src/embedder.test.ts
git commit -m "feat(core): add chunkPage() pure function with heading-boundary splitting"
```

---

### Task 4: Ollama HTTP + `embedProject()` with mock server tests

**Files:**

- Modify: `packages/core/src/embedder.ts`
- Modify: `packages/core/src/embedder.test.ts`

- [ ] **Step 1: Write failing tests for `embedProject`**

Add to `packages/core/src/embedder.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";
import { openDb, closeDb } from "./db.js";
import { indexProject } from "./indexer.js";
import { embedProject, OllamaUnavailableError } from "./embedder.js";

const FAKE_EMBEDDING = new Array(768).fill(0.1);

function startMockOllama(port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/embed") {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
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
  server.listen(port);
  return server;
}

const validConfig: KbConfig = {
  project: { name: "test-embed", version: "0.1.0" },
  directories: { sources: "sources", wiki: "wiki" },
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  dependencies: {},
  search: {
    embedding_provider: "ollama",
    embedding_model: "nomic-embed-text",
    ollama_url: "http://localhost:11435",
    chunk_size: 900,
  },
};

describe("embedProject", () => {
  let tmpDir: string;
  let project: Project;
  let mockServer: Server;

  beforeEach(async () => {
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
      config: validConfig,
    };
    mockServer = startMockOllama(11435);
  });

  afterEach(async () => {
    mockServer.close();
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
        db.prepare("SELECT count(*) as n FROM chunks").get() as any
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
    mockServer.close();
    await writeFile(
      join(project.wikiDir, "page.md"),
      `---\ntitle: Test\n---\n\n${"word ".repeat(30)}\n`,
      "utf8",
    );
    await indexProject(project);

    const badProject = {
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
```

- [ ] **Step 2: Run failing tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run embedder
```

Expected: FAIL (`embedProject` not exported).

- [ ] **Step 3: Implement `embedProject` in `embedder.ts`**

Add to `packages/core/src/embedder.ts`:

```typescript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import Database from "better-sqlite3";
import type { Project } from "./project.js";
import { parsePage } from "./markdown.js";
import { openDb, closeDb } from "./db.js";
import { collectMdFiles } from "./indexer.js"; // re-export or duplicate helper

async function callOllamaEmbed(
  ollamaUrl: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(`${ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new OllamaUnavailableError(
      `Ollama unreachable: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new OllamaUnavailableError(`Ollama returned ${response.status}`);
  }
  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function embedProject(
  project: Project,
  options?: { rebuild?: boolean },
): Promise<EmbedStats> {
  const cfg = project.config.search ?? {
    embedding_provider: "ollama" as const,
    embedding_model: "nomic-embed-text",
    ollama_url: "http://localhost:11434",
    chunk_size: 900,
  };

  const db = openDb(project);
  try {
    if (options?.rebuild) {
      db.exec("DELETE FROM chunks; DELETE FROM chunks_vec;");
    }

    // Collect all wiki markdown files
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    let files: string[] = [];
    try {
      const entries = await readdir(project.wikiDir, {
        recursive: true,
        withFileTypes: true,
      });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => join((e as any).parentPath ?? (e as any).path, e.name));
    } catch {
      files = [];
    }

    const stats: EmbedStats = { embedded: 0, skipped: 0, errors: 0 };

    const getExistingHashStmt = db.prepare<[string], { page_sha256: string }>(
      "SELECT page_sha256 FROM chunks WHERE page_path = ? LIMIT 1",
    );
    const deleteVecStmt = db.prepare(
      "DELETE FROM chunks_vec WHERE rowid IN (SELECT id FROM chunks WHERE page_path = ?)",
    );
    const deleteChunksStmt = db.prepare(
      "DELETE FROM chunks WHERE page_path = ?",
    );
    const insertChunkStmt = db.prepare(
      "INSERT INTO chunks (page_path, heading, content, token_count, page_sha256) VALUES (?, ?, ?, ?, ?)",
    );
    const insertVecStmt = db.prepare(
      "INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)",
    );

    for (const absPath of files) {
      const relPath = relative(project.root, absPath);
      let raw: string;
      try {
        raw = await readFile(absPath, "utf8");
      } catch {
        stats.errors++;
        continue;
      }

      const hash = sha256(raw);

      // Incremental skip: if existing chunk has same hash, skip
      if (!options?.rebuild) {
        const existing = getExistingHashStmt.get(relPath);
        if (existing && existing.page_sha256 === hash) {
          stats.skipped++;
          continue;
        }
      }

      let page: Awaited<ReturnType<typeof parsePage>>;
      try {
        page = await parsePage(absPath, relPath, raw);
      } catch {
        stats.errors++;
        continue;
      }

      const chunks = chunkPage(page, cfg.chunk_size, hash);
      if (chunks.length === 0) {
        stats.skipped++;
        continue;
      }

      // Embed all chunks for this page in a single Ollama call
      const inputs = chunks.map((c) => c.content);
      let embeddings: number[][];
      try {
        embeddings = await callOllamaEmbed(
          cfg.ollama_url,
          cfg.embedding_model,
          inputs,
        );
      } catch (err) {
        if (err instanceof OllamaUnavailableError) throw err;
        stats.errors++;
        continue;
      }

      if (embeddings[0]?.length !== 768) {
        throw new Error(
          `Model returned ${embeddings[0]?.length ?? 0}-dim vectors, expected 768. Update embedding_model or chunk_size.`,
        );
      }

      // Write page chunks and vectors in a transaction
      db.transaction(() => {
        deleteVecStmt.run(relPath);
        deleteChunksStmt.run(relPath);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const info = insertChunkStmt.run(
            chunk.page_path,
            chunk.heading,
            chunk.content,
            chunk.token_count,
            chunk.page_sha256,
          );
          const vecBuf = Buffer.from(new Float32Array(embeddings[i]).buffer);
          insertVecStmt.run(info.lastInsertRowid, vecBuf);
        }
      })();

      stats.embedded++;
    }

    return stats;
  } finally {
    closeDb(db);
  }
}
```

Note: If `collectMdFiles` is not exported from `indexer.ts`, inline the file collection logic (as shown above with `readdir`).

- [ ] **Step 4: Export `collectMdFiles` from `indexer.ts` (if needed)**

Check `indexer.ts`. If `collectMdFiles` is not exported, either export it or keep the inline version above.

- [ ] **Step 5: Build and run tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core build
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run embedder
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/embedder.ts packages/core/src/embedder.test.ts
git commit -m "feat(core): add embedProject() with Ollama HTTP, incremental skip, mock server tests"
```

---

### Task 5: `mergeRrf()` + `vectorSearchWiki()` in `vector-search.ts`

**Files:**

- Create: `packages/core/src/vector-search.ts`
- Create: `packages/core/src/vector-search.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/vector-search.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { SearchResult } from "./search.js";
import { mergeRrf } from "./vector-search.js";

function makeResults(paths: string[]): SearchResult[] {
  return paths.map((path, i) => ({
    rank: -(paths.length - i), // BM25: more negative = better
    path,
    title: path,
    snippet: "",
    tags: [],
  }));
}

describe("mergeRrf", () => {
  it("returns empty array when both lists are empty", () => {
    expect(mergeRrf([], [], 10)).toEqual([]);
  });

  it("uses pure BM25 when vector results are empty", () => {
    const bm25 = makeResults(["a.md", "b.md", "c.md"]);
    const merged = mergeRrf(bm25, [], 5);
    expect(merged.map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(merged[0].searchMode).toBe("hybrid");
  });

  it("promotes pages that rank highly in both lists", () => {
    const bm25 = makeResults(["a.md", "b.md", "c.md"]);
    const vecResults = [
      { page_path: "b.md", best_heading: "## B", distance: 0.1 },
      { page_path: "a.md", best_heading: "", distance: 0.2 },
      { page_path: "d.md", best_heading: "## D", distance: 0.3 },
    ];
    const merged = mergeRrf(bm25, vecResults, 5);
    // "b.md" ranks 2nd in BM25 and 1st in vector — should be near the top
    const paths = merged.map((r) => r.path);
    expect(paths.indexOf("b.md")).toBeLessThanOrEqual(1);
  });

  it("respects the limit parameter", () => {
    const bm25 = makeResults(["a.md", "b.md", "c.md", "d.md", "e.md"]);
    const merged = mergeRrf(bm25, [], 3);
    expect(merged).toHaveLength(3);
  });

  it("marks all results with searchMode hybrid", () => {
    const bm25 = makeResults(["a.md"]);
    const merged = mergeRrf(bm25, [], 5);
    expect(merged.every((r) => r.searchMode === "hybrid")).toBe(true);
  });
});

describe("vectorSearchWiki — empty chunks_vec", () => {
  it("returns empty array when chunks_vec has no rows", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chunks (id INTEGER PRIMARY KEY, page_path TEXT, heading TEXT, content TEXT, token_count INTEGER, page_sha256 TEXT);
    `);
    // No chunks_vec table — simulate "no embeddings"
    const { vectorSearchWiki } = await import("./vector-search.js");
    const results = await vectorSearchWiki(db, "query", {
      embedding_model: "nomic-embed-text",
      ollama_url: "http://localhost:11434",
      chunk_size: 900,
    });
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run vector-search
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `vector-search.ts`**

Create `packages/core/src/vector-search.ts`:

```typescript
import Database from "better-sqlite3";
import type { SearchResult } from "./search.js";
import { OllamaUnavailableError } from "./embedder.js";

export interface SearchConfig {
  embedding_model: string;
  ollama_url: string;
  chunk_size: number;
}

export interface VectorSearchResult {
  page_path: string;
  best_heading: string;
  distance: number;
}

const RRF_K = 60;

export function mergeRrf(
  bm25Results: SearchResult[],
  vecResults: VectorSearchResult[],
  limit: number,
): SearchResult[] {
  if (bm25Results.length === 0 && vecResults.length === 0) return [];

  const allPaths = new Set([
    ...bm25Results.map((r) => r.path),
    ...vecResults.map((r) => r.page_path),
  ]);

  const bm25Rank = new Map(bm25Results.map((r, i) => [r.path, i + 1]));
  const vecRank = new Map(vecResults.map((r, i) => [r.page_path, i + 1]));
  const bm25Map = new Map(bm25Results.map((r) => [r.path, r]));
  const vecMap = new Map(vecResults.map((r) => [r.page_path, r]));

  const scored = Array.from(allPaths).map((path) => {
    const br = bm25Rank.get(path) ?? Infinity;
    const vr = vecRank.get(path) ?? Infinity;
    const score =
      (br === Infinity ? 0 : 1 / (RRF_K + br)) +
      (vr === Infinity ? 0 : 1 / (RRF_K + vr));
    const base = bm25Map.get(path) ?? {
      rank: 0,
      path,
      title: vecMap.get(path)?.page_path ?? path,
      snippet: "",
      tags: [],
    };
    return { ...base, searchMode: "hybrid" as const, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  return scored.slice(0, limit).map(({ _score: _, ...r }) => r);
}

async function embedQuery(
  query: string,
  config: SearchConfig,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(`${config.ollama_url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.embedding_model, input: [query] }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new OllamaUnavailableError(
      `Ollama unreachable: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new OllamaUnavailableError(`Ollama returned ${response.status}`);
  }
  const data = (await response.json()) as { embeddings: number[][] };
  return Buffer.from(new Float32Array(data.embeddings[0]).buffer);
}

export async function vectorSearchWiki(
  db: Database.Database,
  query: string,
  config: SearchConfig,
  limit = 20,
): Promise<VectorSearchResult[]> {
  // Return empty if chunks_vec doesn't exist or has no rows
  try {
    const count = (
      db.prepare("SELECT count(*) as n FROM chunks_vec").get() as any
    ).n;
    if (count === 0) return [];
  } catch {
    return [];
  }

  let queryVec: Buffer;
  try {
    queryVec = await embedQuery(query, config);
  } catch (err) {
    if (err instanceof OllamaUnavailableError) return [];
    throw err;
  }

  interface ChunkVecRow {
    page_path: string;
    heading: string;
    distance: number;
  }

  const rows = db
    .prepare<[Buffer, number], ChunkVecRow>(
      `
      SELECT c.page_path, c.heading, distance
      FROM chunks_vec
      JOIN chunks c ON c.id = chunks_vec.rowid
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `,
    )
    .all(queryVec, limit * 2);

  // Deduplicate to page level: keep best (min distance) chunk per page
  const best = new Map<string, ChunkVecRow>();
  for (const row of rows) {
    const existing = best.get(row.page_path);
    if (!existing || row.distance < existing.distance) {
      best.set(row.page_path, row);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((r) => ({
      page_path: r.page_path,
      best_heading: r.heading,
      distance: r.distance,
    }));
}
```

- [ ] **Step 4: Build and run tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core build
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run vector-search
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/vector-search.ts packages/core/src/vector-search.test.ts
git commit -m "feat(core): add vectorSearchWiki() and mergeRrf() for hybrid search"
```

---

### Task 6: Async hybrid `searchWiki()` with RRF and BM25 fallback

**Files:**

- Modify: `packages/core/src/search.ts`
- Modify: `packages/core/src/search.test.ts`

- [ ] **Step 1: Read the current files**

Read `packages/core/src/search.ts` and `packages/core/src/search.test.ts` in full.

- [ ] **Step 2: Write failing tests for async hybrid `searchWiki`**

Add to `packages/core/src/search.test.ts`:

```typescript
import type { SearchConfig } from "./vector-search.js";

describe("searchWiki — hybrid mode", () => {
  it("returns searchMode bm25 when chunks_vec is empty", async () => {
    await writeFile(
      join(project.wikiDir, "auth.md"),
      `---\ntitle: Auth\n---\n\nAuthentication flow.\n`,
      "utf8",
    );
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = await searchWiki(db, "authentication", project.name);
      // No embeddings → pure BM25
      expect(results[0]?.searchMode).toBe("bm25");
    } finally {
      closeDb(db);
    }
  });
});
```

- [ ] **Step 3: Run failing tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run search
```

Expected: FAIL (`searchWiki` is not async / `searchMode` not in results).

- [ ] **Step 4: Make `searchWiki` async and add hybrid detection**

Update `packages/core/src/search.ts`. Key changes:

1. Add import:

```typescript
import type { SearchConfig, VectorSearchResult } from "./vector-search.js";
import { vectorSearchWiki, mergeRrf } from "./vector-search.js";
```

2. Add `searchMode` to `SearchResult`:

```typescript
export interface SearchResult {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  project?: string;
  searchMode?: "bm25" | "hybrid";
}
```

3. Add `searchConfig` param to `SearchOptions`:

```typescript
export interface SearchOptions {
  limit?: number;
  tags?: string[];
  searchConfig?: SearchConfig;
}
```

4. Make `searchWiki` async:

```typescript
export async function searchWiki(
  db: Database.Database,
  query: string,
  projectName: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  if (!query || query.trim() === "") return [];

  const limit = options?.limit ?? 10;
  const ftsQuery = sanitizeFtsQuery(query.trim());

  // ... (existing BM25 query code unchanged) ...
  const bm25Results: SearchResult[] = rows.map((row) => ({
    rank: row.rank,
    path: row.path,
    title: row.title,
    snippet: row.snippet,
    tags: parseTags(row.tags),
  }));

  // Transparency check: use hybrid only if embeddings exist
  let hasEmbeddings = false;
  try {
    hasEmbeddings =
      ((db.prepare("SELECT count(*) as n FROM chunks_vec").get() as any).n ??
        0) > 0;
  } catch {
    hasEmbeddings = false;
  }

  if (!hasEmbeddings || !options?.searchConfig) {
    return bm25Results.map((r) => ({ ...r, searchMode: "bm25" as const }));
  }

  // Vector search (returns [] on Ollama unavailability — already handled inside)
  const vecResults = await vectorSearchWiki(
    db,
    query,
    options.searchConfig,
    20,
  );
  if (vecResults.length === 0) {
    return bm25Results.map((r) => ({ ...r, searchMode: "bm25" as const }));
  }

  return mergeRrf(bm25Results, vecResults, limit);
}
```

5. Make `searchAcrossProjects` async:

```typescript
export async function searchAcrossProjects(
  targets: CrossProjectTarget[],
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  const allResults: SearchResult[] = [];

  for (const { db, projectName, prefix } of targets) {
    const results = await searchWiki(db, query, projectName, {
      ...options,
      limit: limit * 2,
    });
    for (const r of results) {
      allResults.push({
        ...r,
        path: prefix ? `${prefix}: ${r.path}` : r.path,
        project: prefix,
      });
    }
  }

  allResults.sort((a, b) => a.rank - b.rank);
  return allResults.slice(0, limit);
}
```

- [ ] **Step 5: Update existing `search.test.ts` callers**

All existing tests call `searchWiki(...)` — add `await` to each. Also update the in-memory DB helper in `searchAcrossProjects` tests to `await`.

- [ ] **Step 6: Find all callers of `searchWiki` and `searchAcrossProjects` in the codebase**

```bash
grep -r "searchWiki\|searchAcrossProjects" /Users/loi/workspace/kb/.worktrees/main/packages --include="*.ts" -l
```

Update each caller to `await` the result. The MCP server and CLI search commands are the main call sites.

- [ ] **Step 7: Build and run all tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core build
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --run search
COREPACK_ENABLE_STRICT=0 pnpm build
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: PASS all.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/search.ts packages/core/src/search.test.ts
git commit -m "feat(core): make searchWiki async, add transparent hybrid RRF merge with BM25 fallback"
```

---

### Task 7: `indexProject` calls `embedProject`, CLI index stats/warning

**Files:**

- Modify: `packages/core/src/indexer.ts`
- Modify: `packages/cli/src/commands/index-cmd.ts`

- [ ] **Step 1: Read current files**

Read `packages/core/src/indexer.ts` and `packages/cli/src/commands/index-cmd.ts` in full.

- [ ] **Step 2: Update `IndexStats` in `indexer.ts`**

Add to `IndexStats`:

```typescript
export interface EmbedSummary {
  embedded: number;
  skipped: number;
  errors: number;
  ollamaUnavailable?: boolean;
}

export interface IndexStats {
  indexed: number;
  skipped: number;
  deleted: number;
  errors: number;
  embedStats?: EmbedSummary;
}
```

- [ ] **Step 3: Call `embedProject` after BM25 indexing in `indexProject`**

In `indexProject`, after `return stats;` (actually before it, at the end of the try block):

```typescript
import { embedProject, OllamaUnavailableError } from "./embedder.js";

// After BM25 deletion of stale pages:
try {
  const es = await embedProject(project, { rebuild });
  stats.embedStats = {
    embedded: es.embedded,
    skipped: es.skipped,
    errors: es.errors,
  };
} catch (err) {
  if (err instanceof OllamaUnavailableError) {
    stats.embedStats = {
      embedded: 0,
      skipped: 0,
      errors: 0,
      ollamaUnavailable: true,
    };
  } else {
    throw err;
  }
}
```

Note: `indexProject` must become `async` if it is not already (it is — it already uses `await` internally).

- [ ] **Step 4: Update CLI `index-cmd.ts` to print embed stats**

After printing BM25 index stats, add:

```typescript
if (stats.embedStats) {
  const es = stats.embedStats;
  if (es.ollamaUnavailable) {
    console.warn(chalk.yellow("⚠  Ollama not reachable — skipping embeddings"));
  } else {
    console.log(
      chalk.green(`✓ Embedded ${es.embedded} page(s) (${es.skipped} skipped)`),
    );
  }
}
```

- [ ] **Step 5: Build and run tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm build
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: PASS all.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/indexer.ts packages/cli/src/commands/index-cmd.ts
git commit -m "feat(core,cli): indexProject calls embedProject after BM25, prints embed stats"
```

---

### Task 8: CLI `[hybrid]` badge and core barrel exports

**Files:**

- Modify: `packages/cli/src/commands/search.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Read current files**

Read `packages/cli/src/commands/search.ts` and `packages/core/src/index.ts`.

- [ ] **Step 2: Add `[hybrid]` badge to `search.ts` CLI command**

Find the result-printing section. After `console.log(chalk.bold(...))` or wherever the search header is printed:

```typescript
const modeBadge =
  results[0]?.searchMode === "hybrid" ? chalk.cyan(" [hybrid]") : "";
console.log(`Found ${results.length} result(s) for "${query}"${modeBadge}`);
```

Also pass `searchConfig` from `project.config.search` to `searchWiki`:

```typescript
const results = await searchWiki(db, query, project.name, {
  limit,
  tags: tagFilter,
  searchConfig: project.config.search,
});
```

(Only in the single-project path — cross-project search stays BM25 only.)

- [ ] **Step 3: Update `packages/core/src/index.ts` barrel exports**

Add the following exports:

```typescript
// embedder
export { embedProject, chunkPage, OllamaUnavailableError } from "./embedder.js";
export type { Chunk, EmbedStats } from "./embedder.js";

// vector-search
export { vectorSearchWiki, mergeRrf } from "./vector-search.js";
export type { VectorSearchResult, SearchConfig } from "./vector-search.js";
```

- [ ] **Step 4: Build and run full test suite**

```bash
COREPACK_ENABLE_STRICT=0 pnpm build
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: all tests PASS, no TypeScript errors.

- [ ] **Step 5: Smoke test (optional — requires Ollama running locally)**

```bash
cd /Users/loi/workspace/kb/.worktrees/main
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/cli start -- index
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/cli start -- search "authentication"
```

Expected (if Ollama running): `[hybrid]` badge in output.  
Expected (if Ollama absent): yellow Ollama warning during index, BM25-only search.

- [ ] **Step 6: Final commit**

```bash
git add packages/cli/src/commands/search.ts packages/core/src/index.ts
git commit -m "feat(cli,core): add [hybrid] search badge, export Phase 4 types from core barrel"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] `sqlite-vec` integration → Task 2
- [x] Embedding pipeline → Tasks 3 + 4
- [x] Vector search + page deduplication → Task 5
- [x] Hybrid RRF in `searchWiki` → Task 6
- [x] `kb index --rebuild` passes `rebuild: true` to `embedProject` → Task 7
- [x] Config-driven `[search]` section → Task 1
- [x] Transparent BM25 fallback → Task 6 (empty `chunks_vec` + Ollama unavailable)
- [x] Tests with mock Ollama server → Task 4
- [x] Exports from `core/index.ts` → Task 8

**Type consistency:**

- `EmbedStats` defined in Task 3, used in Tasks 4 and 7 — consistent
- `SearchConfig` defined in Task 5 (`vector-search.ts`), referenced in Task 6 (`search.ts`) — consistent
- `OllamaUnavailableError` defined in Task 3, caught in Tasks 4, 6, 7 — consistent
- `SearchResult.searchMode` added in Task 6, consumed in Tasks 5 (`mergeRrf`) and 8 (CLI badge) — consistent
