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
