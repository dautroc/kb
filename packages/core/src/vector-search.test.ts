import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { SearchResult } from "./search.js";
import { mergeRrf, vectorSearchWiki } from "./vector-search.js";

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
    const results = await vectorSearchWiki(db, "query", {
      embedding_model: "nomic-embed-text",
      ollama_url: "http://localhost:11434",
      chunk_size: 900,
    });
    expect(results).toEqual([]);
  });
});
