import Database from "better-sqlite3";
import type { SearchResult } from "./search.js";
import { OllamaUnavailableError } from "./embedder.js";

// SearchConfig is the runtime search configuration subset.
// KbConfig.search (in config.ts) is a superset that also includes embedding_provider.
export interface SearchConfig {
  embedding_provider?: "ollama";
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

  return scored
    .slice(0, limit)
    .map(({ _score: _s, ...r }) => r as SearchResult);
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
      `Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`,
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
      db.prepare("SELECT count(*) as n FROM chunks_vec").get() as { n: number }
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
