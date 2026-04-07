# Phase 4: Hybrid Search with Vector Embeddings — Design

**Date:** 2026-04-07  
**Status:** Approved

---

## Goal

Add semantic search to `kb` by embedding wiki page chunks via Ollama and storing vectors in sqlite-vec. Hybrid retrieval (BM25 + vector, merged with RRF) activates transparently when embeddings exist. Pure BM25 remains the fallback when Ollama is unavailable.

---

## Architecture

Five files in `packages/core/src/`:

| File               | Change     | Responsibility                                                                             |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `embedder.ts`      | **New**    | Chunk pages at heading boundaries, call Ollama, write vectors to DB                        |
| `vector-search.ts` | **New**    | Embed a query via Ollama, run cosine similarity via sqlite-vec, return ranked page results |
| `db.ts`            | **Modify** | Add `chunks` + `chunks_vec` tables; auto-migrate existing DBs                              |
| `indexer.ts`       | **Modify** | Call `embedProject()` after BM25 indexing; catch `OllamaUnavailableError` and warn         |
| `search.ts`        | **Modify** | Transparent hybrid: detect embeddings, merge BM25 + vector via RRF, fall back to BM25      |

CLI change: `kb index --rebuild` passes `{ rebuild: true }` to both `indexProject()` and `embedProject()`.

Config change: new optional `[search]` section in `.kb/config.toml`.

---

## Config

New optional section in `.kb/config.toml` (all fields have defaults):

```toml
[search]
embedding_provider = "ollama"            # only "ollama" supported in Phase 4
embedding_model = "nomic-embed-text"     # any Ollama model that returns embeddings
ollama_url = "http://localhost:11434"    # overridable for remote Ollama
chunk_size = 900                         # approximate tokens per chunk
```

`KbConfig` gains an optional `search` field:

```typescript
search?: {
  embedding_provider: "ollama";
  embedding_model: string;
  ollama_url: string;
  chunk_size: number;
}
```

Defaults applied in `mergeConfigs()` when `[search]` is absent:

- `embedding_provider`: `"ollama"`
- `embedding_model`: `"nomic-embed-text"`
- `ollama_url`: `"http://localhost:11434"`
- `chunk_size`: `900`

---

## Data Model

Two new tables added to the existing `index.db` via `openDb()` / `migrateDb()`:

```sql
-- One row per chunk
CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY,
  page_path   TEXT    NOT NULL,
  heading     TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0
);

-- sqlite-vec virtual table — row ids mirror chunks.id
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  embedding float[768]
);
```

`nomic-embed-text` produces 768-dimensional vectors. If a different model is configured, `vec0` dimension must match the model output — validated at embed time (error if mismatch).

**Incremental skip:** Before embedding a page, compare `page_meta.sha256` against the hash stored when chunks were last written. A new `chunk_meta` map (`page_path → sha256`) is maintained as a plain `SELECT` against `chunks` is not enough — add a `chunk_sha256` column to `chunks`:

```sql
-- chunks table (full definition)
CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY,
  page_path    TEXT    NOT NULL,
  heading      TEXT    NOT NULL DEFAULT '',
  content      TEXT    NOT NULL,
  token_count  INTEGER NOT NULL DEFAULT 0,
  page_sha256  TEXT    NOT NULL DEFAULT ''  -- hash of page at embed time
);
```

Skip a page if any existing chunk has `page_sha256 = current_sha256`.

---

## Embedding Pipeline (`embedder.ts`)

### Chunking

Split a `ParsedPage` at markdown heading boundaries. Algorithm:

1. Walk through the page content line by line, tracking current heading breadcrumb.
2. Accumulate lines into a buffer. When a new heading is encountered, flush the buffer as a chunk if it has content.
3. If a section exceeds `chunk_size` tokens (approximated as `words * 1.3`), split further at paragraph boundaries (double newline).
4. Minimum chunk size: 20 tokens — discard shorter fragments.

Each chunk carries: `page_path`, `heading` (breadcrumb string, e.g. `"## Auth > ### Token refresh"`), `content`, `token_count`.

### Ollama call

Single `POST {ollama_url}/api/embed` per page (batch all chunks in one request):

```json
{ "model": "nomic-embed-text", "input": ["chunk 1 text", "chunk 2 text"] }
```

Response: `{ "embeddings": [[...], [...]] }`.

Timeout: 30 seconds per request. If the connection is refused or times out, throw `OllamaUnavailableError`.

### Write path (per page, inside a transaction)

```
1. DELETE FROM chunks_vec WHERE rowid IN (SELECT id FROM chunks WHERE page_path = ?)
2. DELETE FROM chunks WHERE page_path = ?
3. For each chunk: INSERT INTO chunks → get lastInsertRowid
4. INSERT INTO chunks_vec (rowid, embedding) VALUES (lastInsertRowid, ?)
```

### Exported API

```typescript
export class OllamaUnavailableError extends Error {}

export interface EmbedStats {
  embedded: number; // pages with new/updated embeddings
  skipped: number; // pages unchanged since last embed
  errors: number; // pages that failed
}

export async function embedProject(
  project: Project,
  options?: { rebuild?: boolean },
): Promise<EmbedStats>;
```

---

## Vector Search (`vector-search.ts`)

`SearchConfig` is a plain object derived from `KbConfig.search` defaults:

```typescript
interface SearchConfig {
  embedding_model: string; // e.g. "nomic-embed-text"
  ollama_url: string; // e.g. "http://localhost:11434"
  chunk_size: number; // e.g. 900
}
```

### Query embedding

```typescript
async function embedQuery(
  query: string,
  config: SearchConfig,
): Promise<Float32Array>;
```

Same `POST /api/embed` call, single-element input array.

### Chunk-level KNN query

```sql
SELECT c.page_path, c.heading, distance
FROM chunks_vec
JOIN chunks c ON c.id = chunks_vec.rowid
WHERE embedding MATCH ? AND k = 40
ORDER BY distance
```

sqlite-vec uses `embedding MATCH <vector_blob> AND k = N` syntax for KNN queries.

### Deduplicate to page level

Group chunk results by `page_path`, keeping the minimum distance (best chunk). This produces a ranked list of pages.

### Exported API

```typescript
export interface VectorSearchResult {
  page_path: string;
  best_heading: string; // heading of the best-matching chunk
  distance: number; // cosine distance (lower = better)
}

export async function vectorSearchWiki(
  db: Database.Database,
  query: string,
  config: SearchConfig,
  limit?: number,
): Promise<VectorSearchResult[]>;
// Returns empty array (not an error) if chunks_vec is empty or Ollama unavailable
```

---

## Hybrid Search (`search.ts`)

### Transparency check

At the top of `searchWiki()`:

```typescript
const hasEmbeddings =
  db.prepare("SELECT count(*) as n FROM chunks_vec").get().n > 0;
```

If `false`: return pure BM25 result with `searchMode: "bm25"`.

### RRF merge

Reciprocal Rank Fusion with `k = 60`:

```
rrf_score(page) = 1/(60 + bm25_rank) + 1/(60 + vector_rank)
```

Pages only in one list use `rank = ∞` (contributing `0` to the missing term).

BM25 fetches top 20 (page-level). Vector fetches top 20 (page-level after deduplication). Merge, sort by RRF score descending, return top N.

### `SearchResult` update

```typescript
export interface SearchResult {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  project?: string;
  searchMode?: "bm25" | "hybrid"; // new optional field
}
```

### Fallback

If Ollama throws `OllamaUnavailableError` during query embedding, log to stderr and return pure BM25 results with `searchMode: "bm25"`.

---

## CLI Changes

### `kb index`

After `indexProject()` completes:

```
const embedStats = await embedProject(project).catch((err) => {
  if (err instanceof OllamaUnavailableError) {
    console.warn(chalk.yellow("⚠  Ollama not reachable — skipping embeddings"));
    return null;
  }
  throw err;
});
```

If `embedStats` is non-null, print:

```
✓ Embedded N page(s) (M skipped)
```

### `kb index --rebuild`

Passes `{ rebuild: true }` to both `indexProject()` and `embedProject()`.

### `kb search`

If result has `searchMode: "hybrid"`, print a subtle suffix:

```
Found 5 results for "authentication flow": [hybrid]
```

---

## Testing Strategy

- **`embedder.test.ts`** — unit tests with a mock HTTP server (using `node:http`) for the Ollama endpoint. Test: chunking, incremental skip, rebuild, `OllamaUnavailableError` on connection refused.
- **`vector-search.test.ts`** — test RRF merge logic with synthetic ranked lists (no Ollama needed). Test: deduplication, fallback to BM25 on empty `chunks_vec`.
- **`db.test.ts`** — extend existing tests to verify `chunks` and `chunks_vec` tables are created on `openDb()`.
- **Integration** — extend `integration.test.ts` with a mock Ollama server: init → index (with embeddings) → search → verify `searchMode: "hybrid"`.

End-to-end Ollama tests are skipped in CI (require `OLLAMA_URL` env var to be set).

---

## Error Cases

| Scenario                                             | Behaviour                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Ollama not running at `kb index` time                | Yellow warning, exit 0, BM25 index still built                                                                                  |
| Ollama not running at `kb search` time               | Fallback to BM25, one-line stderr warning                                                                                       |
| Chunk vector dimension mismatch                      | `embedProject()` throws with clear message: "Model returned N-dim vectors, expected 768. Update chunk_size or embedding_model." |
| `chunks_vec` table not yet populated (fresh install) | `searchWiki()` detects empty table, uses pure BM25 silently                                                                     |
| Partial embedding failure (one page errors)          | `EmbedStats.errors++`, continue with remaining pages                                                                            |

---

## Phase 4 Deliverables Checklist

- [ ] `sqlite-vec` integration for vector storage (`db.ts`)
- [ ] Embedding pipeline: chunk → embed → store (`embedder.ts`)
- [ ] Vector search with page-level deduplication (`vector-search.ts`)
- [ ] Hybrid retrieval with RRF merged into `searchWiki()` (`search.ts`)
- [ ] `kb index --rebuild` regenerates all embeddings
- [ ] Config-driven search settings (`[search]` in `config.toml`)
- [ ] Transparent fallback to BM25 when Ollama unreachable
- [ ] Tests for all new modules (mock Ollama server, no live dependency)
- [ ] Export new types/functions from `packages/core/src/index.ts`
