# kb — Usage Guide

`kb` is a CLI tool for maintaining an LLM-powered knowledge base wiki. You feed it sources (docs, PDFs, URLs), it uses an LLM to summarise and organise them into a structured markdown wiki, and you can query that wiki in natural language.

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Project Structure](#project-structure)
4. [Configuration](#configuration)
5. [Commands](#commands)
6. [MCP Server (Agent Integration)](#mcp-server-agent-integration)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Installation

Build and install from source:

```bash
git clone <repo-url>
cd kb
pnpm install
pnpm --filter kb-core run build
pnpm --filter kb-mcp run build
pnpm --filter kb-tool run build
npm install -g packages/cli
```

Verify:

```bash
kb --version
```

---

## Quick Start

```bash
# 1. Initialise a knowledge base in your project directory
cd my-project
kb init

# 2. Set your LLM API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Preview what would happen if you ingest a document (dry-run by default)
kb ingest docs/architecture.md

# 4. Apply the ingest (writes files to the wiki)
kb ingest docs/architecture.md --apply

# 5. Ask a question
kb query "What are the main architectural decisions?"

# 6. Search the wiki
kb search "authentication flow"

# 7. Check wiki health
kb lint
```

---

## Project Structure

After `kb init`, your project will contain:

```
my-project/
├── .kb/
│   ├── config.toml     # Project config (LLM provider, directories, dependencies)
│   ├── schema.md       # LLM instructions — wiki conventions, templates, workflows
│   └── index.db        # SQLite search index (auto-generated, gitignore this)
├── sources/            # Raw source files (copied here on ingest --apply)
├── wiki/
│   └── _index.md       # Wiki root / table of contents
└── log.md              # Append-only activity log
```

Add `.kb/index.db` to `.gitignore` — it is auto-regenerated.

---

## Configuration

### Global config — `~/.kb/config.toml`

Created automatically on first `kb init`. Sets defaults for all projects on your machine.

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[directories]
sources = "sources"
wiki = "wiki"
```

### Project config — `.kb/config.toml`

Per-project overrides. Values here take precedence over the global config.

```toml
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
# shared-glossary = { path = "../shared-glossary" }
```

### LLM Providers

| Provider       | Key         | Config value             | Required env var                                                   |
| -------------- | ----------- | ------------------------ | ------------------------------------------------------------------ |
| Anthropic      | `anthropic` | `provider = "anthropic"` | `ANTHROPIC_API_KEY`                                                |
| OpenAI         | `openai`    | `provider = "openai"`    | `OPENAI_API_KEY`                                                   |
| Ollama (local) | `ollama`    | `provider = "ollama"`    | `OLLAMA_BASE_URL` (optional, defaults to `http://localhost:11434`) |
| Z.AI           | `zai`       | `provider = "zai"`       | `ZAI_API_KEY`                                                      |

**Recommended models:**

```toml
# Anthropic (best quality)
provider = "anthropic"
model = "claude-sonnet-4-20250514"

# OpenAI
provider = "openai"
model = "gpt-4o"

# Local via Ollama (free, no API key)
provider = "ollama"
model = "llama3.2"
```

---

## Commands

### `kb init [project-name]`

Initialises a new knowledge base in the current directory.

```bash
kb init                  # uses directory name as project name
kb init "my-wiki"        # explicit project name
```

Creates `.kb/`, `sources/`, `wiki/_index.md`, and `log.md`. Also creates `~/.kb/config.toml` with defaults if it doesn't exist yet.

---

### `kb status`

Shows a summary of the current project.

```bash
kb status
# Project: my-project (v0.1.0)
# Wiki pages: 12
# Sources: 5
# Last log entry: 2026-04-07 — Ingested architecture.md
```

---

### `kb ingest <source-path> [--apply] [--batch]`

Processes a source document into the wiki using the configured LLM.

```bash
# Dry-run (default) — shows what would change without writing anything
kb ingest docs/design.md

# Apply — actually writes wiki pages and updates the index
kb ingest docs/design.md --apply

# Ingest a PDF
kb ingest papers/transformer-paper.pdf --apply

# Ingest a URL
kb ingest https://example.com/api-docs --apply

# Batch ingest all files in a directory
kb ingest sources/papers/ --batch --apply
```

**What happens on ingest:**

1. Reads the source (markdown, text, PDF, or URL)
2. Reads the current `wiki/_index.md` and `.kb/schema.md`
3. Sends everything to the LLM with instructions to integrate the new knowledge
4. LLM returns: a summary page, updates to existing pages, new pages, and an updated index
5. On `--apply`: writes all files, appends to `log.md`, re-indexes

**Dry-run is the default** — always preview before applying.

---

### `kb query <question>`

Asks a natural-language question against the wiki.

```bash
kb query "What are the tradeoffs between REST and GraphQL?"
kb query "How does the authentication system work?"

# Save the answer back into the wiki (feeds knowledge back in)
kb query "Summarise the deployment architecture" --save wiki/deployment-summary.md
```

**Flow:** BM25 search → top pages retrieved → LLM synthesises answer with wikilink citations → printed to terminal.

The `--save` flag is powerful: answers that cite multiple pages become new wiki pages themselves, compounding your knowledge base.

---

### `kb search <query>`

Full-text BM25 search across wiki pages.

```bash
kb search "authentication"
kb search "database schema" --limit 5
kb search "security" --tags security,architecture
kb search "API design" --json          # machine-readable output
```

Results show: rank, path, title, matching snippet.

---

### `kb index [--rebuild]`

Manually triggers re-indexing of wiki pages.

```bash
kb index             # incremental — only re-indexes changed files
kb index --rebuild   # drops and re-indexes everything from scratch
```

Indexing runs automatically before `search`, `query`, and `lint`, so you rarely need this manually. Use `--rebuild` if the index seems stale or corrupt.

---

### `kb lint [--deep]`

Checks wiki health and reports issues.

```bash
kb lint
```

**Static checks (always run):**

| Code            | Severity | Description                                     |
| --------------- | -------- | ----------------------------------------------- |
| `ORPHAN_PAGE`   | warning  | Page has no inbound wikilinks                   |
| `BROKEN_LINK`   | warning  | A `[[wikilink]]` target doesn't exist           |
| `STUB_PAGE`     | info     | Page has no links and fewer than 50 words       |
| `STALE_SUMMARY` | warning  | Source file was modified after the summary page |
| `MISSING_INDEX` | info     | Page not linked from `_index.md`                |

```bash
kb lint --deep    # LLM-assisted checks (Phase 2 — coming soon)
```

Exit code `0` = clean, `1` = issues found.

---

### `kb log [--last N]`

Shows recent wiki activity.

```bash
kb log              # last 10 entries
kb log --last 25    # last 25 entries
```

---

### `kb mcp`

Starts an MCP (Model Context Protocol) server on stdio. Used for agent integrations like Claude Code.

```bash
kb mcp
```

See [MCP Server](#mcp-server-agent-integration) below.

---

### `kb agent-context [--write]`

Generates a markdown context block describing the wiki for inclusion in `CLAUDE.md` or `AGENTS.md`.

```bash
kb agent-context          # prints to stdout
kb agent-context --write  # appends to CLAUDE.md in the project root
```

---

## MCP Server (Agent Integration)

`kb mcp` exposes the wiki to any MCP-compatible LLM agent (Claude Code, Cursor, etc.).

### Setup with Claude Code

Add to your `claude_desktop_config.json` or `.mcp.json`:

```json
{
  "mcpServers": {
    "kb": {
      "command": "kb",
      "args": ["mcp"]
    }
  }
}
```

Or run `kb agent-context --write` to append instructions to your `CLAUDE.md` automatically.

### Available MCP Tools

| Tool              | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `kb_search`       | Full-text search. Returns ranked results with snippets.                   |
| `kb_get_page`     | Retrieve the full content of a page by path.                              |
| `kb_get_index`    | Get `_index.md` for navigation.                                           |
| `kb_list_sources` | List raw sources with metadata.                                           |
| `kb_ingest`       | Trigger ingestion (returns proposed changes; use `apply: true` to write). |
| `kb_lint`         | Run lint checks, return findings.                                         |
| `kb_backlinks`    | Get all pages that link to a given page.                                  |
| `kb_status`       | Project metadata — name, page count, last activity.                       |

**Usage pattern for agents:** Call `kb_search` first (small token footprint), then `kb_get_page` only for relevant results. Never call `kb_get_page` on all results.

---

## Best Practices

### Start with a good `schema.md`

The auto-generated `.kb/schema.md` is a starting point. Edit it to match your domain:

- Define the types of pages your project uses (entities, concepts, decisions, etc.)
- Add project-specific frontmatter fields
- Include examples of good wiki pages

The LLM reads `schema.md` on every ingest and query — it's the most important file in your knowledge base.

### Use dry-run before every ingest

```bash
kb ingest paper.pdf        # review first
kb ingest paper.pdf --apply  # then apply
```

Review the proposed changes. The LLM may create pages you didn't expect or update pages in ways that don't fit your conventions.

### Save good answers back to the wiki

```bash
kb query "How does authentication work across services?" \
  --save wiki/concepts/cross-service-auth.md
```

A well-crafted answer synthesised from multiple sources often makes a better wiki page than any individual source. This is Karpathy's key insight.

### Run `kb lint` regularly

Make it part of your workflow (e.g., pre-commit):

```bash
kb lint && git commit -m "Update wiki"
```

Fix orphan pages by linking them from relevant pages or from `_index.md`. Broken links indicate the LLM hallucinated a page that doesn't exist — create it or remove the link.

### Use a global config for API keys and model preferences

Put shared settings in `~/.kb/config.toml` so you don't repeat them per project:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
```

Override per project only when needed (e.g., a project that requires a cheaper/faster model).

### Keep sources immutable

The `sources/` directory is for raw, original materials. Never edit files there — if a source updates, re-ingest it. This lets you always re-derive the wiki from scratch.

### Batch ingest in order

When ingesting many sources, order matters — each ingest sees the wiki as updated by previous ingests:

```bash
# Ingest foundational docs first, then specifics
kb ingest sources/overview.md --apply
kb ingest sources/design-decisions.md --apply
kb ingest sources/api-spec.md --apply

# Or use --batch (processes in filesystem order)
kb ingest sources/ --batch --apply
```

---

## Troubleshooting

**`No kb project found`**
You're not in a `kb` project directory. Run `kb init` or navigate to the project root.

**`ANTHROPIC_API_KEY environment variable is not set`**
Export your key: `export ANTHROPIC_API_KEY=sk-ant-...`

**`Cannot find module 'kb-core'`** (build error)
Build packages in order — core declarations must generate before mcp-server builds:

```bash
pnpm --filter kb-core run build && \
pnpm --filter kb-mcp run build && \
pnpm --filter kb-tool run build
```

**Index seems stale or search returns wrong results**

```bash
kb index --rebuild
```

**LLM response fails to parse**
The LLM returned malformed JSON. Retry — this is usually transient. If persistent, check that your model supports structured output (avoid very small local models for ingest/query).

**PDF ingestion fails**
Install pdf-parse in your project:

```bash
npm install pdf-parse
```
