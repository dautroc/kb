import Database from "better-sqlite3";
import type { SearchConfig, VectorSearchResult } from "./vector-search.js";
import { vectorSearchWiki, mergeRrf } from "./vector-search.js";

export interface SearchResult {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  project?: string;
  searchMode?: "bm25" | "hybrid";
}

export interface SearchOptions {
  limit?: number;
  tags?: string[];
  searchConfig?: SearchConfig;
}

interface FtsRow {
  path: string;
  title: string;
  tags: string;
  rank: number;
  snippet: string;
}

function sanitizeFtsQuery(query: string): string {
  // Split into tokens, quote each one to escape special FTS5 chars.
  // Using individual quoted tokens (AND logic) instead of a single phrase
  // so non-adjacent words still match.
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

function parseTags(raw: string): string[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export async function searchWiki(
  db: Database.Database,
  query: string,
  projectName: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  if (!query || query.trim() === "") {
    return [];
  }

  const limit = options?.limit ?? 10;
  const ftsQuery = sanitizeFtsQuery(query.trim());

  // Build dynamic tag WHERE clauses so filtering happens in SQL
  const filterTags = options?.tags?.length
    ? options.tags
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    : [];

  const tagClauses = filterTags.map(() => "AND lower(tags) LIKE ?").join(" ");
  const tagParams = filterTags.map((t) => `%${t}%`);

  const stmt = db.prepare<[string, string, ...string[], number], FtsRow>(`
    SELECT path, title, tags, bm25(pages) as rank,
           snippet(pages, 2, '', '', '...', 8) as snippet
    FROM pages
    WHERE pages MATCH ? AND project = ?
    ${tagClauses}
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(ftsQuery, projectName, ...tagParams, limit);

  const bm25Results: SearchResult[] = rows.map((row) => ({
    rank: row.rank,
    path: row.path,
    title: row.title,
    snippet: row.snippet,
    tags: parseTags(row.tags),
  }));

  // Transparency check: hybrid only if embeddings exist AND config provided
  let hasEmbeddings = false;
  try {
    hasEmbeddings =
      ((
        db.prepare("SELECT count(*) as n FROM chunks_vec").get() as {
          n: number;
        }
      ).n ?? 0) > 0;
  } catch {
    hasEmbeddings = false;
  }

  if (!hasEmbeddings || !options?.searchConfig) {
    return bm25Results.map((r) => ({ ...r, searchMode: "bm25" as const }));
  }

  // Vector search (returns [] on Ollama unavailability)
  const vecResults: VectorSearchResult[] = await vectorSearchWiki(
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

export interface CrossProjectTarget {
  db: Database.Database;
  projectName: string;
  prefix?: string;
}

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

  // BM25 rank from FTS5: more negative = better match
  allResults.sort((a, b) => a.rank - b.rank);
  return allResults.slice(0, limit);
}
