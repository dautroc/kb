function sanitizeFtsQuery(query) {
    // Split into tokens, quote each one to escape special FTS5 chars.
    // Using individual quoted tokens (AND logic) instead of a single phrase
    // so non-adjacent words still match.
    const tokens = query
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    if (tokens.length === 0)
        return '""';
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}
function parseTags(raw) {
    if (!raw || raw.trim() === "")
        return [];
    return raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}
export function searchWiki(db, query, projectName, options) {
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
    const stmt = db.prepare(`
    SELECT path, title, tags, bm25(pages) as rank,
           snippet(pages, 2, '', '', '...', 8) as snippet
    FROM pages
    WHERE pages MATCH ? AND project = ?
    ${tagClauses}
    ORDER BY rank
    LIMIT ?
  `);
    const rows = stmt.all(ftsQuery, projectName, ...tagParams, limit);
    const results = rows.map((row) => ({
        rank: row.rank,
        path: row.path,
        title: row.title,
        snippet: row.snippet,
        tags: parseTags(row.tags),
    }));
    return results;
}
//# sourceMappingURL=search.js.map