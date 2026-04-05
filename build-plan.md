# Build Plan: `kb` — Project-Scoped LLM Wiki CLI

> A CLI tool that implements Karpathy's LLM Wiki pattern for project knowledge management.
> Each project gets an isolated, LLM-maintained wiki. Projects can reference each other's knowledge without merging.

---

## Guiding Principles

1. **Markdown-native** — Everything is plain markdown files in a git repo. No proprietary formats.
2. **LLM does the writing** — The human curates sources and asks questions. The LLM summarizes, cross-references, and maintains.
3. **Project isolation by default, linking by intent** — Knowledge doesn't leak across projects unless explicitly declared as a dependency.
4. **CLI-first, MCP-native** — Designed for terminal workflows and LLM agent integration from day one.
5. **Progressive complexity** — A single project works with zero config. Workspaces and dependencies are opt-in.

---

## Phase 0: Scaffold & Core Data Model (Week 1–2)

**Goal:** Ship `kb init` and establish the foundational filesystem contract.

### 0.1 — Project bootstrap

Set up a TypeScript monorepo (using pnpm workspaces) with three internal packages:

```
packages/
├── cli/          # Command-line interface (commander.js)
├── core/         # Business logic — project model, config, file I/O
└── mcp-server/   # MCP server (Phase 2)
```

Tooling: TypeScript 5.x, tsup (bundling), vitest (testing), biome (lint/format).

Distribute as a single npm package: `npm install -g @anthropic/kb` (or whatever name).

### 0.2 — `kb init [project-name]`

Initializes a new project knowledge base in the current directory:

```
my-project/
├── .kb/
│   ├── config.toml       # Project manifest
│   └── schema.md         # LLM instructions (the "schema" layer)
├── sources/              # Raw, immutable source materials
├── wiki/
│   └── _index.md         # Wiki root (auto-generated stub)
└── log.md                # Append-only activity log
```

**config.toml** (minimal starting point):

```toml
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"          # anthropic | openai | ollama
model = "claude-sonnet-4-20250514"

[dependencies]
# shared-glossary = { path = "../shared-glossary" }
```

**schema.md** — Auto-generated LLM instruction file. This is Karpathy's "schema layer." Contains: wiki structure conventions, page templates (entity, concept, source-summary, comparison), frontmatter schema, wikilink conventions, ingest/query/lint workflow descriptions. The user and LLM co-evolve this over time.

### 0.3 — Config parser & project resolver

- Parse `config.toml` using `@iarna/toml`.
- Build a `Project` model: `{ name, root, sourcesDir, wikiDir, config, dependencies }`.
- Implement project discovery: walk up from `cwd` to find nearest `.kb/config.toml` (like how git finds `.git/`).
- Validate directory structure on every command entry.

### Deliverables
- [ ] `kb init` creates project scaffold
- [ ] `kb status` prints project name, page count, source count, last log entry
- [ ] Config parser with validation and helpful error messages
- [ ] Project auto-discovery from any subdirectory

---

## Phase 1: Single-Project Wiki Operations (Week 3–6)

**Goal:** Implement the three core operations — Ingest, Query, Lint — for a single project.

### 1.1 — Search index (BM25 via SQLite FTS5)

Start with full-text search only. Vector search is Phase 4.

- Use `better-sqlite3` with FTS5 extension.
- Index stored at `.kb/index.db`.
- Schema:

```sql
CREATE VIRTUAL TABLE pages USING fts5(
  path,           -- relative path from project root
  title,          -- extracted from first H1 or frontmatter
  content,        -- full markdown body (stripped of frontmatter)
  tags,           -- comma-separated from frontmatter
  project,        -- project name (for future cross-project search)
  tokenize='porter unicode61'
);

CREATE TABLE page_meta (
  path TEXT PRIMARY KEY,
  sha256 TEXT,          -- content hash for incremental re-index
  mtime INTEGER,        -- file modification time
  word_count INTEGER,
  frontmatter TEXT,     -- raw YAML frontmatter as JSON
  outgoing_links TEXT,  -- JSON array of [[wikilinks]] found
  updated_at INTEGER
);
```

- **Incremental indexing**: On `kb index` (or auto before search), compare file checksums. Only re-index changed files.
- **Markdown parsing**: Use `remark` + `remark-frontmatter` + `remark-wiki-link` to extract structure, links, and metadata.
- **Wikilink extraction**: Parse `[[page-name]]` and `[[page-name|display text]]` from all wiki pages. Store as edges in `page_meta.outgoing_links`. This powers backlink queries and orphan detection later.

### 1.2 — `kb search <query>`

```bash
kb search "authentication flow"
# Returns ranked results with path, title, snippet, BM25 score
```

- Query FTS5 with `MATCH` and `bm25()` ranking.
- Display results as: rank, path, title, highlighted snippet (extract 2–3 sentences around match).
- Flags: `--limit N`, `--json` (machine-readable for LLM piping), `--tags <tag>` (filter by frontmatter tag).

### 1.3 — `kb ingest <source-path> [--batch]`

This is the most complex operation. It orchestrates an LLM call to process a source and update the wiki.

**Single-source flow:**

```
1. Copy/move source file → sources/ (preserve original, mark immutable)
2. Read source content (markdown, PDF via pdf-parse, URL via fetch+readability)
3. Read wiki/_index.md to understand existing wiki structure
4. Read schema.md for conventions and templates
5. Send to LLM with structured prompt:
   - "Here is a new source. Here is the current wiki index.
      Here are the wiki conventions from schema.md.
      Tasks: (a) Write a source summary page.
      (b) List which existing wiki pages need updates.
      (c) For each, provide the updated content.
      (d) List any new entity/concept pages to create.
      (e) Update _index.md.
      Return as structured JSON."
6. Parse LLM response → write/update files
7. Append entry to log.md
8. Re-index changed files
```

**LLM response contract** (enforced via system prompt + JSON schema):

```typescript
interface IngestResult {
  summary: {
    path: string;          // e.g., "wiki/sources/paper-x-summary.md"
    content: string;       // full markdown
  };
  updates: Array<{
    path: string;          // existing wiki page to update
    content: string;       // full updated content
    reason: string;        // why this page was updated
  }>;
  newPages: Array<{
    path: string;
    content: string;
    reason: string;
  }>;
  indexUpdate: string;     // updated _index.md content
  logEntry: string;        // one-line log description
}
```

**Key design decisions:**
- **Full-page replacement, not diffs.** LLMs are unreliable at producing precise diffs. Easier to have the LLM return the full updated page and let git handle diff display.
- **Dry-run by default.** `kb ingest paper.pdf` shows what *would* change (like `terraform plan`). `kb ingest paper.pdf --apply` writes files. This keeps the human in the loop, addressing the epistemic integrity concern from the gist comments.
- **Batch mode.** `kb ingest --batch sources/papers/` processes multiple sources sequentially, with the wiki updating between each (so later sources see earlier updates).

### 1.4 — `kb query <question>`

Ask a question against the wiki. The LLM searches, reads, and synthesizes.

```bash
kb query "What are the tradeoffs between REST and GraphQL in our architecture?"
```

**Flow:**

```
1. Run BM25 search for the question → top 10 pages
2. Read schema.md for answer conventions
3. Send to LLM: question + retrieved pages + schema instructions
4. LLM produces: answer with [[wikilink]] citations to wiki pages
5. Display answer in terminal (rendered markdown via marked-terminal)
6. Optionally: --save <path> to file the answer back into the wiki
```

The `--save` flag is critical — it implements Karpathy's insight that good answers should compound back into the wiki.

### 1.5 — `kb lint`

Health-check the wiki. Outputs actionable findings.

```bash
kb lint
# ⚠  Orphan page: wiki/concepts/cqrs.md (0 inbound links)
# ⚠  Broken link: wiki/architecture/overview.md → [[event-sourcing]] (page not found)
# ⚠  Stale page: wiki/sources/q1-report-summary.md (source updated 45 days after summary)
# ℹ  Missing page: "rate limiting" mentioned 4 times but has no dedicated page
# ℹ  Suggestion: Consider creating a comparison page for REST vs GraphQL
```

**Checks (static, no LLM needed):**
- Orphan pages (no inbound wikilinks)
- Broken wikilinks (target doesn't exist)
- Pages with no outbound links (potential stubs)
- Stale summaries (source file modified after summary's frontmatter date)
- Missing `_index.md` entries

**Checks (LLM-assisted, opt-in via `--deep`):**
- Contradictions between pages
- Claims that newer sources have superseded
- Important concepts mentioned but lacking dedicated pages
- Suggested new questions to investigate

### Deliverables
- [ ] SQLite FTS5 index with incremental re-indexing
- [ ] `kb search` with ranked results and snippets
- [ ] `kb ingest` with dry-run default, --apply to write, --batch for multiple
- [ ] `kb query` with wiki-grounded answers and --save
- [ ] `kb lint` with static checks + optional --deep LLM analysis
- [ ] `kb index` to manually trigger re-index
- [ ] `kb log` to view recent activity

---

## Phase 2: MCP Server & Agent Integration (Week 7–9)

**Goal:** Make the knowledge base accessible to any MCP-compatible LLM agent.

### 2.1 — MCP server (`kb mcp`)

Run as a stdio MCP server (for Claude Code, Cursor, etc.):

```bash
kb mcp
# Starts MCP server on stdio, scoped to the current project
```

**Exposed tools:**

| Tool | Description |
|------|-------------|
| `kb_search` | Hybrid search across wiki pages. Returns ranked results with snippets. |
| `kb_get_page` | Retrieve full content of a wiki page by path. |
| `kb_get_index` | Return the wiki's `_index.md` for navigation. |
| `kb_list_sources` | List all raw sources with metadata. |
| `kb_ingest` | Trigger ingestion of a source (returns proposed changes). |
| `kb_lint` | Run lint checks, return findings. |
| `kb_backlinks` | Get all pages that link to a given page. |
| `kb_status` | Project metadata — name, page count, last activity. |

Use `@modelcontextprotocol/sdk` for the server implementation.

**Progressive disclosure pattern**: `kb_search` returns path + title + snippet (small token footprint). The agent then calls `kb_get_page` only for pages it actually needs. This keeps token usage proportional to relevance.

### 2.2 — Auto-generated agent context

`kb init` and `kb agent-context` generate a block for CLAUDE.md / AGENTS.md:

```markdown
## Knowledge Base: my-project

This project has an LLM-maintained knowledge base at `./wiki/`.
- Wiki index: `wiki/_index.md`
- Schema/conventions: `.kb/schema.md`
- Raw sources: `sources/`
- Activity log: `log.md`

### Available CLI commands
- `kb search <query>` — Search the wiki
- `kb ingest <path> --apply` — Process a new source into the wiki
- `kb query <question>` — Ask a question against the wiki
- `kb lint` — Health-check the wiki
- `kb lint --deep` — LLM-assisted deep health check

### MCP tools available
This project exposes an MCP server via `kb mcp`.
Tools: kb_search, kb_get_page, kb_get_index, kb_ingest, kb_lint, kb_backlinks.

### Wiki conventions
[auto-extracted summary from .kb/schema.md]
```

### 2.3 — Claude Code integration

Add to `CLAUDE.md`:

```markdown
When working on this project, use the `kb` CLI to search and reference
the knowledge base before making architectural decisions. After significant
discussions or decisions, run `kb ingest` or use `kb query --save` to
capture knowledge back into the wiki.
```

### Deliverables
- [ ] `kb mcp` — stdio MCP server with all tools
- [ ] `kb agent-context` — generate CLAUDE.md / AGENTS.md block
- [ ] Integration test: Claude Code session using kb MCP tools
- [ ] Token budget tracking in MCP responses (report tokens used)

---

## Phase 3: Multi-Project Workspaces & Cross-Project References (Week 10–13)

**Goal:** Enable isolated projects to declare dependencies and reference each other's knowledge.

### 3.1 — Workspace manifest

```toml
# .kbworkspace.toml (at workspace root)
[workspace]
members = [
  "projects/*",
  "shared/*"
]

[workspace.defaults]
llm.provider = "anthropic"
llm.model = "claude-sonnet-4-20250514"
```

`kb workspace init` creates this file and discovers member projects.

### 3.2 — Dependency declaration & resolution

In a project's `.kb/config.toml`:

```toml
[dependencies]
# Local path dependency (same workspace)
shared-glossary = { path = "../shared/glossary" }

# Git-backed remote dependency (cached locally)
company-standards = { git = "https://github.com/org/standards-kb.git", branch = "main" }

# Read-only reference (search but don't modify)
design-system = { path = "../shared/design-system", mode = "readonly" }
```

**Resolution logic:**

```
1. Parse current project's dependencies
2. For each path dependency: validate it's a valid kb project (has .kb/config.toml)
3. For each git dependency: clone/pull to .kb/cache/<name>/, validate structure
4. Build a dependency graph, detect cycles (error if found)
5. Make dependency wikis available for search and linking
```

### 3.3 — Cross-project link syntax

```markdown
<!-- Link to a page in a dependency -->
[[kb://shared-glossary/terms/api-gateway]]

<!-- Link with display text -->
[[kb://shared-glossary/terms/api-gateway|API Gateway]]

<!-- Search across dependencies -->
```

**Parser implementation:** Extend the remark-wiki-link plugin to recognize the `kb://` prefix. Split into `project` + `path` segments. Resolve against declared dependencies only (not arbitrary projects).

`kb lint` gains a new check: **broken cross-project links** (target project exists but page doesn't, or project not declared as dependency).

### 3.4 — Cross-project search

```bash
# Search current project only (default)
kb search "authentication"

# Search current project + all dependencies
kb search "authentication" --deps

# Search a specific dependency
kb search "authentication" --project shared-glossary

# Search entire workspace
kb search "authentication" --workspace
```

Implementation: each project has its own `.kb/index.db`. Cross-project search queries multiple databases and merges results with project-name prefixes.

The MCP server gains a `kb_search_workspace` tool for workspace-wide search.

### 3.5 — Dependency-aware ingest

When ingesting a source, the LLM should know about dependent projects' knowledge:

```
1. Read current project's wiki/_index.md
2. Read each dependency's wiki/_index.md (lightweight — just the catalog)
3. Include in LLM prompt: "You have access to these related knowledge bases: [names + indexes]"
4. LLM can reference dependency pages via [[kb://...]] links in generated content
5. LLM CANNOT modify dependency wiki pages (read-only by design)
```

### Deliverables
- [ ] `.kbworkspace.toml` manifest and workspace discovery
- [ ] Dependency declaration in `config.toml` (path + git)
- [ ] Git dependency cloning and caching
- [ ] `[[kb://project/path]]` link parser and resolver
- [ ] Cross-project search (`--deps`, `--workspace`)
- [ ] Cross-project broken link detection in `kb lint`
- [ ] MCP tools for workspace-level operations
- [ ] `kb deps` — show dependency tree
- [ ] `kb deps update` — pull latest for git dependencies

---

## Phase 4: Hybrid Search with Vector Embeddings (Week 14–16)

**Goal:** Add semantic search for better recall on conceptual queries.

### 4.1 — Embedding pipeline

- Use `sqlite-vec` extension for vector storage in the same `index.db`.
- Default embedding model: `nomic-embed-text-v1.5` via Ollama (local, free).
- Fallback: OpenAI `text-embedding-3-small` or Anthropic's embeddings (if available).
- Chunk wiki pages at heading boundaries (~900 tokens per chunk, matching qmd's approach).
- Store chunks with metadata: `{ page_path, heading_breadcrumb, chunk_index, embedding }`.

```sql
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  embedding float[768]  -- nomic-embed-text dimensionality
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  page_path TEXT,
  heading TEXT,
  content TEXT,
  token_count INTEGER
);
```

### 4.2 — Hybrid retrieval

```
1. Query expansion: generate 2-3 query variants via LLM (optional, adds latency)
2. BM25 search via FTS5 → top 20
3. Vector search via sqlite-vec (cosine similarity) → top 20
4. Reciprocal Rank Fusion (k=60) to merge results
5. Return top 10 with combined scores
```

### 4.3 — Config

```toml
[search]
mode = "hybrid"              # "bm25" | "vector" | "hybrid"
embedding_model = "nomic-embed-text-v1.5"
embedding_provider = "ollama" # "ollama" | "openai"
chunk_size = 900              # tokens per chunk
```

### Deliverables
- [ ] sqlite-vec integration for vector storage
- [ ] Embedding pipeline (chunk → embed → store)
- [ ] Hybrid retrieval with RRF
- [ ] `kb index --rebuild` to regenerate all embeddings
- [ ] Config-driven search mode selection

---

## Phase 5: Polish, UX & Ecosystem (Week 17–20)

### 5.1 — Source format support

Expand `kb ingest` to handle:
- **PDF** → text extraction via `pdf-parse` (or `pdfjs-dist`)
- **URL** → fetch + readability extraction (like Obsidian Web Clipper)
- **YouTube** → transcript fetch via `youtube-transcript-api`
- **Audio/video** → transcription via Whisper (local or API), store transcript as source
- **Images** → LLM vision description, store as source with image reference

```bash
kb ingest https://arxiv.org/abs/2401.12345 --apply
kb ingest meeting-recording.mp3 --apply
kb ingest screenshot.png --apply
```

### 5.2 — Interactive TUI mode

`kb tui` opens an interactive terminal UI (using Ink or blessed) with:
- Live search with results updating as you type
- Page preview pane (rendered markdown)
- Wiki graph visualization (ASCII-based, showing link topology)
- Ingest queue with progress indicators

### 5.3 — Export & output formats

```bash
kb export --format html --output ./dist/    # Static site (11ty or custom)
kb export --format pdf --page wiki/overview.md
kb query "Compare X vs Y" --format marp     # Slide deck
kb query "Summarize the project" --format canvas  # Obsidian canvas
```

### 5.4 — Git integration

- `kb diff` — show wiki changes since last commit (meaningful diff, not just raw text)
- `kb history <page>` — show git log for a specific wiki page
- Pre-commit hook: auto-run `kb lint` before commit, warn on broken links

### 5.5 — Obsidian compatibility

The wiki directory should be openable as an Obsidian vault with zero config:
- Standard `[[wikilinks]]` that Obsidian resolves natively
- YAML frontmatter that Dataview can query
- Cross-project links render as plain text in Obsidian (graceful degradation) but are resolvable by `kb`
- `.obsidian/` config is gitignored — Obsidian is a viewer, not a dependency

### Deliverables
- [ ] Multi-format source ingestion (PDF, URL, audio, image)
- [ ] Interactive TUI with live search
- [ ] HTML static site export
- [ ] Git-aware commands (diff, history)
- [ ] Obsidian compatibility verification
- [ ] `kb doctor` — full environment check (LLM connectivity, index health, dependency resolution)

---

## CLI Command Summary

```
kb init [name]              Initialize a new knowledge base project
kb status                   Project overview (pages, sources, last activity)

kb ingest <source> [--apply] [--batch]   Process source(s) into the wiki
kb query <question> [--save <path>]      Ask a question against the wiki
kb search <query> [--deps] [--workspace] Search wiki pages
kb lint [--deep]                         Health-check the wiki

kb index [--rebuild]        Rebuild search index
kb log [--last N]           View activity log

kb mcp                      Start MCP server (stdio)
kb agent-context            Generate CLAUDE.md / AGENTS.md block

kb workspace init           Initialize a workspace
kb deps                     Show dependency tree
kb deps update              Pull latest git dependencies

kb tui                      Interactive terminal UI
kb export [--format]        Export wiki to other formats
kb doctor                   Environment and health check
```

---

## Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x | Best markdown ecosystem, MCP SDK support, fast iteration |
| CLI framework | Commander.js | Mature, composable, good help generation |
| Build | tsup | Fast bundling, single-file output |
| Test | Vitest | Fast, TypeScript-native |
| Markdown | remark + plugins | Battle-tested, extensible, unified ecosystem |
| Frontmatter | gray-matter | Standard for markdown frontmatter parsing |
| Config | @iarna/toml | TOML parsing with good error messages |
| Database | better-sqlite3 + FTS5 | BM25 search, zero-server, single file |
| Vectors (Phase 4) | sqlite-vec | Vector search in same SQLite DB |
| MCP | @modelcontextprotocol/sdk | Official SDK, stdio transport |
| LLM calls | Anthropic SDK / OpenAI SDK | Direct API calls, model-agnostic adapter |
| File watching | chokidar | Cross-platform, debounced |
| Terminal UI | Ink (React for CLI) | Composable, familiar model |
| PDF parsing | pdf-parse | Lightweight, no native deps |
| URL extraction | @mozilla/readability | Same engine as Firefox Reader View |

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| LLM produces inconsistent wiki updates | High | Dry-run default, human review before --apply, structured JSON schema for responses |
| Token costs spiral on large wikis | Medium | Progressive disclosure via MCP, chunk-level retrieval, token budgets in config |
| Cross-project link resolution is fragile | Medium | Strict resolution via declared dependencies only, lint catches broken links |
| sqlite-vec not available on all platforms | Low | Graceful fallback to BM25-only mode, vector search is Phase 4 / optional |
| LLM provider lock-in | Medium | Adapter pattern from day one — provider interface with Anthropic/OpenAI/Ollama implementations |
| Wiki grows beyond context window | Medium | Hierarchical summarization (folder → page → chunk), index-first navigation |
| Competing tools emerge quickly | Low | Ship fast, focus on the cross-project dependency story (unique differentiator) |
