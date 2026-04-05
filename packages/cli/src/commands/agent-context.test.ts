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
