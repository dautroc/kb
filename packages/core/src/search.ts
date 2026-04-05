import Database from "better-sqlite3";

export interface SearchResult {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  tags: string[];
}

export interface SearchOptions {
  limit?: number;
  tags?: string[];
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

export function searchWiki(
  db: Database.Database,
  query: string,
  projectName: string,
  options?: SearchOptions,
): SearchResult[] {
  if (!query || query.trim() === "") {
    return [];
  }

  const limit = options?.limit ?? 10;
  const ftsQuery = sanitizeFtsQuery(query.trim());

  const stmt = db.prepare<[string, string, number], FtsRow>(`
    SELECT path, title, tags, bm25(pages) as rank,
           snippet(pages, 2, '', '', '...', 8) as snippet
    FROM pages
    WHERE pages MATCH ? AND project = ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(ftsQuery, projectName, limit);

  let results: SearchResult[] = rows.map((row) => ({
    rank: row.rank,
    path: row.path,
    title: row.title,
    snippet: row.snippet,
    tags: parseTags(row.tags),
  }));

  if (options?.tags && options.tags.length > 0) {
    const filterTags = options.tags.map((t) => t.trim().toLowerCase());
    results = results.filter((r) => {
      const resultTags = r.tags.map((t) => t.toLowerCase());
      return filterTags.every((ft) => resultTags.includes(ft));
    });
  }

  return results;
}
