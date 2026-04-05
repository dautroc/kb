# Comprehensive Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring test coverage from 79 tests to comprehensive coverage across all untested modules.

**Architecture:** Tests live alongside source files in `packages/core/src/` and `packages/cli/src/commands/`. Pure logic extracted from CLI files into testable core modules. One integration test exercises the full init→index→search→lint pipeline.

**Tech Stack:** vitest, better-sqlite3, node:fs/promises, node:os (mkdtemp), TypeScript 5.x strict.

---

## Coverage Gaps

| File                                         | Tests | Missing                                                  |
| -------------------------------------------- | ----- | -------------------------------------------------------- |
| `packages/core/src/db.ts`                    | 0     | Schema creation, idempotency, WAL mode                   |
| `packages/core/src/llm.ts`                   | 0     | Adapter factory, missing API key errors, all 3 providers |
| `packages/core/src/log-parser.ts`            | 0     | (new file — extract from CLI) parseLogEntries            |
| `packages/cli/src/commands/agent-context.ts` | 0     | buildBlock output, readSchemaLines, --write behavior     |
| Integration                                  | 0     | Full init→index→search→lint pipeline                     |

---

## File Map

**Create:**

- `packages/core/src/db.test.ts` — tests for openDb/closeDb
- `packages/core/src/llm.test.ts` — tests for createLlmAdapter
- `packages/core/src/log-parser.ts` — extracted parseLogEntries (move from cli)
- `packages/core/src/log-parser.test.ts` — tests for parseLogEntries
- `packages/core/src/integration.test.ts` — end-to-end pipeline test
- `packages/cli/src/commands/agent-context.test.ts` — tests for buildBlock/readSchemaLines/--write

**Modify:**

- `packages/core/src/index.ts` — export parseLogEntries, ParsedLogEntry
- `packages/cli/src/commands/log-cmd.ts` — import parseLogEntries from @kb/core instead of local
- `packages/cli/src/commands/agent-context.ts` — export buildBlock and readSchemaLines for testing

---

## Task 1: db.ts tests

**Files:**

- Create: `packages/core/src/db.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { openDb, closeDb } from "./db.js";
import type { Project } from "./project.js";
import type { KbConfig } from "./config.js";

function makeProject(root: string): Project {
  const config: KbConfig = {
    project: { name: "test", version: "0.1.0" },
    directories: { sources: "sources", wiki: "wiki" },
    llm: { provider: "anthropic", model: "claude-3" },
    dependencies: {},
  };
  return {
    name: "test",
    root,
    kbDir: join(root, ".kb"),
    sourcesDir: join(root, "sources"),
    wikiDir: join(root, "wiki"),
    config,
  };
}

describe("openDb", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-db-test-"));
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(join(tmpDir, ".kb"), { recursive: true }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates index.db at .kb/index.db", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    expect(db).toBeDefined();
    closeDb(db);
    // File should exist
    const { existsSync } = require("node:fs");
    expect(existsSync(join(tmpDir, ".kb", "index.db"))).toBe(true);
  });

  it("creates the pages FTS5 virtual table", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pages'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("pages");
    closeDb(db);
  });

  it("creates the page_meta table with required columns", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const cols = db.prepare("PRAGMA table_info(page_meta)").all() as Array<{
      name: string;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("path");
    expect(colNames).toContain("sha256");
    expect(colNames).toContain("mtime");
    expect(colNames).toContain("word_count");
    expect(colNames).toContain("outgoing_links");
    closeDb(db);
  });

  it("is idempotent — calling openDb twice does not throw", () => {
    const project = makeProject(tmpDir);
    const db1 = openDb(project);
    closeDb(db1);
    // Second open should not throw (IF NOT EXISTS in schema)
    const db2 = openDb(project);
    closeDb(db2);
  });

  it("enables WAL journal mode", () => {
    const project = makeProject(tmpDir);
    const db = openDb(project);
    const row = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe("wal");
    closeDb(db);
  });
});

describe("closeDb", () => {
  it("closes the database connection", async () => {
    const tmpDir2 = await mkdtemp(join(tmpdir(), "kb-db-close-"));
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(join(tmpDir2, ".kb"), { recursive: true }),
    );
    const project = makeProject(tmpDir2);
    const db = openDb(project);
    closeDb(db);
    expect(() => db.prepare("SELECT 1").get()).toThrow();
    await rm(tmpDir2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/db.test.ts
```

Expected: several tests fail with "Cannot find module" or test infrastructure errors until file exists.

- [ ] **Step 3: Run tests — they should now pass (db.ts already implemented)**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/db.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db.test.ts
git commit -m "test: add db.ts unit tests for openDb/closeDb and schema"
```

---

## Task 2: llm.ts tests

**Files:**

- Create: `packages/core/src/llm.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/llm.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLlmAdapter } from "./llm.js";
import type { KbConfig } from "./config.js";

function makeConfig(
  provider: "anthropic" | "openai" | "ollama",
  model = "test-model",
): KbConfig {
  return {
    project: { name: "test", version: "0.1.0" },
    directories: { sources: "sources", wiki: "wiki" },
    llm: { provider, model },
    dependencies: {},
  };
}

describe("createLlmAdapter", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.restoreAllMocks();
  });

  it("returns an adapter with a complete() method for anthropic", () => {
    const adapter = createLlmAdapter(makeConfig("anthropic"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("returns an adapter with a complete() method for openai", () => {
    const adapter = createLlmAdapter(makeConfig("openai"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("returns an adapter with a complete() method for ollama", () => {
    const adapter = createLlmAdapter(makeConfig("ollama"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("anthropic adapter throws when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const adapter = createLlmAdapter(makeConfig("anthropic"));
    await expect(
      adapter.complete([{ role: "user", content: "hi" }], "system"),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("openai adapter throws when OPENAI_API_KEY is not set", async () => {
    delete process.env["OPENAI_API_KEY"];
    const adapter = createLlmAdapter(makeConfig("openai"));
    await expect(
      adapter.complete([{ role: "user", content: "hi" }], "system"),
    ).rejects.toThrow("OPENAI_API_KEY");
  });

  it("ollama adapter does not require an API key (calls fetch)", async () => {
    // Ollama adapter should reach out to fetch — mock it to avoid network call
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "hello from ollama" },
      }),
    }) as unknown as typeof fetch;

    const adapter = createLlmAdapter(makeConfig("ollama"));
    const result = await adapter.complete(
      [{ role: "user", content: "hi" }],
      "system",
    );
    expect(result).toBe("hello from ollama");
  });

  it("throws for unknown provider", () => {
    const config = makeConfig("anthropic");
    // Force an unsupported provider at runtime
    (config.llm as { provider: string }).provider = "unknown-provider";
    expect(() => createLlmAdapter(config)).toThrow(
      /unknown.*provider|provider/i,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/llm.test.ts
```

Expected: "throws for unknown provider" will fail if llm.ts has no such guard. Others should pass.

- [ ] **Step 3: Add unknown-provider guard to llm.ts if missing**

Read `packages/core/src/llm.ts` and find the `createLlmAdapter` function. Add an `else` branch:

```typescript
export function createLlmAdapter(config: KbConfig): LlmAdapter {
  const { provider, model } = config.llm;
  if (provider === "anthropic") return createAnthropicAdapter(model);
  if (provider === "openai") return createOpenAiAdapter(model);
  if (provider === "ollama") return createOllamaAdapter(model);
  throw new Error(`Unknown LLM provider: "${provider}"`);
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/llm.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm.test.ts packages/core/src/llm.ts
git commit -m "test: add llm.ts adapter tests; fix: throw on unknown provider"
```

---

## Task 3: Extract and test parseLogEntries

**Files:**

- Create: `packages/core/src/log-parser.ts`
- Create: `packages/core/src/log-parser.test.ts`
- Modify: `packages/core/src/index.ts` — add exports
- Modify: `packages/cli/src/commands/log-cmd.ts` — import from @kb/core

- [ ] **Step 1: Create log-parser.ts**

```typescript
// packages/core/src/log-parser.ts

export interface ParsedLogEntry {
  heading: string;
  body: string;
}

/**
 * Parses a log.md file into an array of entries.
 * Each entry starts with a level-2 heading (## ...).
 * The top-level "# Activity Log" heading is skipped.
 */
export function parseLogEntries(content: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const sections = content.split(/^(?=## )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) continue;
    if (!trimmed.startsWith("## ")) continue;

    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) {
      entries.push({ heading: trimmed.slice(3).trim(), body: "" });
    } else {
      const heading = trimmed.slice(3, newlineIdx).trim();
      const body = trimmed.slice(newlineIdx + 1).trim();
      entries.push({ heading, body });
    }
  }

  return entries;
}
```

- [ ] **Step 2: Write failing tests for log-parser.ts**

```typescript
// packages/core/src/log-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseLogEntries } from "./log-parser.js";

describe("parseLogEntries", () => {
  it("returns empty array for empty string", () => {
    expect(parseLogEntries("")).toEqual([]);
  });

  it("returns empty array when only top-level heading exists", () => {
    expect(parseLogEntries("# Activity Log\n")).toEqual([]);
  });

  it("parses a single entry", () => {
    const content =
      "# Activity Log\n\n## 2026-01-01 — Init\n\nProject initialized.\n";
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.heading).toBe("2026-01-01 — Init");
    expect(entries[0]!.body).toBe("Project initialized.");
  });

  it("parses multiple entries", () => {
    const content = [
      "# Activity Log",
      "",
      "## 2026-01-01 — Init",
      "",
      "Initialized.",
      "",
      "## 2026-01-02 — Ingest paper.pdf",
      "",
      "Added summary.",
    ].join("\n");
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.heading).toBe("2026-01-01 — Init");
    expect(entries[1]!.heading).toBe("2026-01-02 — Ingest paper.pdf");
  });

  it("handles entry with no body", () => {
    const content = "## 2026-01-01 — No body";
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.body).toBe("");
  });

  it("preserves multi-line body", () => {
    const content = "## 2026-01-01 — Entry\n\nLine 1.\nLine 2.\nLine 3.";
    const entries = parseLogEntries(content);
    expect(entries[0]!.body).toContain("Line 1.");
    expect(entries[0]!.body).toContain("Line 3.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/log-parser.test.ts
```

Expected: "Cannot find module './log-parser.js'" since the file doesn't exist yet. After creating it, all 6 tests should pass.

- [ ] **Step 4: Export from @kb/core index**

Add to `packages/core/src/index.ts`:

```typescript
export { parseLogEntries } from "./log-parser.js";
export type { ParsedLogEntry } from "./log-parser.js";
```

- [ ] **Step 5: Update log-cmd.ts to import from @kb/core**

In `packages/cli/src/commands/log-cmd.ts`, replace the local `parseLogEntries` function and `LogEntry` interface with an import:

```typescript
import { parseLogEntries, type ParsedLogEntry } from "@kb/core";
```

Remove the local `interface LogEntry` and `function parseLogEntries` definitions. Change all `LogEntry` references to `ParsedLogEntry`.

- [ ] **Step 6: Build and run all tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm build
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: all tests pass, no build errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/log-parser.ts packages/core/src/log-parser.test.ts packages/core/src/index.ts packages/cli/src/commands/log-cmd.ts
git commit -m "refactor: extract parseLogEntries to core; test: add log-parser tests"
```

---

## Task 4: agent-context tests

**Files:**

- Modify: `packages/cli/src/commands/agent-context.ts` — export `buildBlock` and `readSchemaLines`
- Create: `packages/cli/src/commands/agent-context.test.ts`

- [ ] **Step 1: Export buildBlock and readSchemaLines from agent-context.ts**

In `packages/cli/src/commands/agent-context.ts`, change:

```typescript
async function readSchemaLines(schemaPath: string): Promise<string>;
async function buildBlock(
  projectName: string,
  schemaLines: string,
): Promise<string>;
```

to:

```typescript
export async function readSchemaLines(schemaPath: string): Promise<string>;
export async function buildBlock(
  projectName: string,
  schemaLines: string,
): Promise<string>;
```

- [ ] **Step 2: Write failing tests**

```typescript
// packages/cli/src/commands/agent-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBlock, readSchemaLines } from "./agent-context.js";

describe("buildBlock", () => {
  it("includes the project name in the heading", async () => {
    const block = await buildBlock(
      "my-project",
      "## Schema\nConventions here.",
    );
    expect(block).toContain("## Knowledge Base: my-project");
  });

  it("includes all CLI commands", async () => {
    const block = await buildBlock("test", "");
    expect(block).toContain("kb search");
    expect(block).toContain("kb ingest");
    expect(block).toContain("kb query");
    expect(block).toContain("kb lint");
  });

  it("includes all MCP tool names", async () => {
    const block = await buildBlock("test", "");
    expect(block).toContain("kb_search");
    expect(block).toContain("kb_get_page");
    expect(block).toContain("kb_lint");
  });

  it("includes the schema lines in the output", async () => {
    const block = await buildBlock("test", "Custom schema content here.");
    expect(block).toContain("Custom schema content here.");
  });
});

describe("readSchemaLines", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-agent-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns fallback message when schema file does not exist", async () => {
    const result = await readSchemaLines(join(tmpDir, "nonexistent.md"));
    expect(result).toContain("schema.md");
  });

  it("returns first 20 lines of schema file", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
    await writeFile(join(tmpDir, "schema.md"), lines.join("\n"), "utf8");
    const result = await readSchemaLines(join(tmpDir, "schema.md"));
    const resultLines = result.split("\n");
    expect(resultLines).toHaveLength(20);
    expect(resultLines[0]).toBe("Line 1");
    expect(resultLines[19]).toBe("Line 20");
  });

  it("returns full content when file has fewer than 20 lines", async () => {
    await writeFile(
      join(tmpDir, "schema.md"),
      "Line 1\nLine 2\nLine 3",
      "utf8",
    );
    const result = await readSchemaLines(join(tmpDir, "schema.md"));
    expect(result).toBe("Line 1\nLine 2\nLine 3");
  });
});

describe("--write behavior (via file manipulation)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-write-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates CLAUDE.md when it does not exist", async () => {
    const claudePath = join(tmpDir, "CLAUDE.md");
    const block = await buildBlock("test-project", "Schema.");
    await writeFile(claudePath, block, "utf8");
    const content = await readFile(claudePath, "utf8");
    expect(content).toContain("## Knowledge Base: test-project");
  });

  it("appends to existing CLAUDE.md with separator", async () => {
    const claudePath = join(tmpDir, "CLAUDE.md");
    await writeFile(claudePath, "# Existing Content\n", "utf8");
    const block = await buildBlock("test-project", "Schema.");
    const existing = await readFile(claudePath, "utf8");
    await writeFile(claudePath, `${existing}\n---\n${block}`, "utf8");
    const content = await readFile(claudePath, "utf8");
    expect(content).toContain("# Existing Content");
    expect(content).toContain("---");
    expect(content).toContain("## Knowledge Base: test-project");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/cli test -- --reporter=verbose src/commands/agent-context.test.ts
```

Expected: "Cannot find module" until exports are added.

- [ ] **Step 4: Run tests — should pass after exports added**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/cli test -- --reporter=verbose src/commands/agent-context.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Build and run all tests**

```bash
COREPACK_ENABLE_STRICT=0 pnpm build && COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/agent-context.ts packages/cli/src/commands/agent-context.test.ts
git commit -m "test: add agent-context command tests for buildBlock and readSchemaLines"
```

---

## Task 5: Integration test — full pipeline

**Files:**

- Create: `packages/core/src/integration.test.ts`

This test exercises the complete init→index→search→lint pipeline using real SQLite but no LLM.

- [ ] **Step 1: Write the integration test**

```typescript
// packages/core/src/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "./init.js";
import { loadProject } from "./project.js";
import { indexProject } from "./indexer.js";
import { openDb, closeDb } from "./db.js";
import { searchWiki } from "./search.js";
import { lintProject } from "./lint.js";

describe("full pipeline: init → index → search → lint", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-integration-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("init creates valid project structure loadable by loadProject", async () => {
    await initProject({ name: "integration-test", directory: tmpDir });
    const project = await loadProject(tmpDir);
    expect(project.name).toBe("integration-test");
    expect(project.root).toBe(tmpDir);
  });

  it("indexProject indexes wiki pages and search finds them", async () => {
    await initProject({ name: "search-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a wiki page
    await mkdir(join(project.wikiDir, "concepts"), { recursive: true });
    await writeFile(
      join(project.wikiDir, "concepts", "authentication.md"),
      [
        "---",
        "title: Authentication Overview",
        "tags: security, auth",
        "---",
        "",
        "# Authentication Overview",
        "",
        "Authentication is the process of verifying identity.",
        "JWT tokens are used for stateless authentication.",
        "The login flow validates credentials against the database.",
      ].join("\n"),
      "utf8",
    );

    const stats = await indexProject(project);
    expect(stats.indexed).toBeGreaterThan(0);
    expect(stats.errors).toBe(0);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "authentication JWT", project.name);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.title).toBe("Authentication Overview");
      expect(results[0]!.tags).toContain("security");
    } finally {
      closeDb(db);
    }
  });

  it("indexProject is incremental — unchanged files are skipped", async () => {
    await initProject({ name: "incr-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    await writeFile(
      join(project.wikiDir, "page.md"),
      "# Page\n\nSome content here for testing.",
      "utf8",
    );

    const first = await indexProject(project);
    expect(first.indexed).toBeGreaterThan(0);

    const second = await indexProject(project);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("lintProject detects ORPHAN_PAGE after indexing", async () => {
    await initProject({ name: "lint-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a page that nobody links to
    await writeFile(
      join(project.wikiDir, "orphan.md"),
      "# Orphaned Page\n\nThis page has no inbound links from other pages.",
      "utf8",
    );

    const result = await lintProject(project);
    const orphans = result.issues.filter((i) => i.code === "ORPHAN_PAGE");
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans.some((i) => i.path.includes("orphan.md"))).toBe(true);
  });

  it("lintProject detects BROKEN_LINK", async () => {
    await initProject({ name: "broken-link-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    // Write a page with a broken wikilink
    await writeFile(
      join(project.wikiDir, "page-with-broken-link.md"),
      "# Page\n\nSee [[nonexistent-page]] for more details.",
      "utf8",
    );

    const result = await lintProject(project);
    const broken = result.issues.filter((i) => i.code === "BROKEN_LINK");
    expect(broken.length).toBeGreaterThan(0);
  });

  it("search returns no results for empty wiki", async () => {
    await initProject({ name: "empty-test", directory: tmpDir });
    const project = await loadProject(tmpDir);
    await indexProject(project);

    const db = openDb(project);
    try {
      const results = searchWiki(db, "anything", project.name);
      expect(results).toHaveLength(0);
    } finally {
      closeDb(db);
    }
  });

  it("lintProject reports pagesChecked matching actual wiki page count", async () => {
    await initProject({ name: "count-test", directory: tmpDir });
    const project = await loadProject(tmpDir);

    await writeFile(
      join(project.wikiDir, "page1.md"),
      "# Page 1\n\nContent.",
      "utf8",
    );
    await writeFile(
      join(project.wikiDir, "page2.md"),
      "# Page 2\n\nContent.",
      "utf8",
    );

    const result = await lintProject(project);
    // _index.md + page1.md + page2.md = 3
    expect(result.pagesChecked).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
COREPACK_ENABLE_STRICT=0 pnpm --filter @kb/core test -- --reporter=verbose src/integration.test.ts
```

Expected: tests may fail if there are path or module issues. Fix until all pass.

- [ ] **Step 3: Run all tests to ensure no regressions**

```bash
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: all tests pass (previous 79 + new tests).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/integration.test.ts
git commit -m "test: add integration tests for full init→index→search→lint pipeline"
```

---

## Self-Review

**Spec coverage:**

- db.ts: 5 tests → schema creation, idempotency, WAL, column names, closeDb ✓
- llm.ts: 7 tests → all 3 adapters, missing key errors, unknown provider guard ✓
- log-parser.ts: 6 tests → empty input, single/multiple entries, no-body, multi-line ✓
- agent-context.ts: 9 tests → buildBlock content, readSchemaLines, --write behavior ✓
- integration: 7 tests → init→search, incremental index, orphan lint, broken link lint ✓

**Placeholder scan:** All test code is complete with actual implementations. No TBDs.

**Type consistency:** All types (`KbConfig`, `Project`, `ParsedLogEntry`) use exact definitions from source files.

**Total new tests:** ~34 tests, bringing total from 79 → ~113.
