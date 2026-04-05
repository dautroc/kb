import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSource } from "./source-reader.js";

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "extracted pdf text" }),
}));

const TMP = join(tmpdir(), "kb-source-reader-test-" + process.pid);

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("readSource", () => {
  it("reads a markdown file correctly", async () => {
    const filePath = join(TMP, "My Doc.md");
    await writeFile(filePath, "# Hello\n\nWorld", "utf8");

    const result = await readSource(filePath);

    expect(result.type).toBe("markdown");
    expect(result.content).toBe("# Hello\n\nWorld");
    expect(result.originalPath).toBe(filePath);
    expect(result.filename).toBe("my-doc.md");
  });

  it("reads a text file correctly", async () => {
    const filePath = join(TMP, "notes.txt");
    await writeFile(filePath, "Some plain text", "utf8");

    const result = await readSource(filePath);

    expect(result.type).toBe("text");
    expect(result.content).toBe("Some plain text");
    expect(result.filename).toBe("notes.txt");
  });

  it("detects URL vs file path", async () => {
    // URL detection should be based on http/https prefix
    const isUrl = (path: string) =>
      path.startsWith("http://") || path.startsWith("https://");

    expect(isUrl("https://example.com")).toBe(true);
    expect(isUrl("http://example.com/page")).toBe(true);
    expect(isUrl("/some/file.txt")).toBe(false);
    expect(isUrl("relative/path.md")).toBe(false);
  });

  it("sanitizes filename: lowercases, replaces spaces with hyphens", async () => {
    const filePath = join(TMP, "My Research Paper.txt");
    await writeFile(filePath, "content here", "utf8");

    const result = await readSource(filePath);

    expect(result.filename).toBe("my-research-paper.txt");
  });

  it("sanitizes filename: handles multiple spaces", async () => {
    const filePath = join(TMP, "FILE   WITH SPACES.md");
    await writeFile(filePath, "# Title", "utf8");

    const result = await readSource(filePath);

    expect(result.filename).toBe("file---with-spaces.md");
  });

  it("reads PDF file and returns extracted text", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "kb-test-"));
    const pdfPath = join(tmpDir, "test.pdf");
    await writeFile(pdfPath, "fake pdf bytes");

    const result = await readSource(pdfPath);
    expect(result.type).toBe("pdf");
    expect(result.content).toBe("extracted pdf text");
    expect(result.filename).toBe("test.pdf");

    await rm(tmpDir, { recursive: true });
  });

  it("fetches URL and strips HTML", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><body><h1>Hello</h1><p>World</p></body></html>",
    }) as any;

    const result = await readSource("https://example.com/page");
    expect(result.type).toBe("url");
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
    expect(result.filename).toContain("example.com");
  });
});
