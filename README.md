# kb

A CLI tool that implements [Karpathy's LLM Wiki pattern](https://x.com/karpathy/status/1869369558691803569) for project knowledge management. Each project gets an isolated, LLM-maintained wiki. The LLM summarizes, cross-references, and maintains — the human curates sources and asks questions.

## Install

```bash
npm install -g @kb/cli
```

Or run directly:

```bash
npx @kb/cli init
```

## Quick Start

```bash
# Initialize a knowledge base in your project
kb init my-project

# Ingest a source document (dry-run by default)
kb ingest paper.pdf

# Apply the ingestion
kb ingest paper.pdf --apply

# Search the wiki
kb search "authentication flow"

# Ask a question
kb query "What are the tradeoffs between REST and GraphQL?"

# Health check
kb lint
```

## Commands

| Command                                                 | Description                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `kb init [name]`                                        | Initialize a new knowledge base in the current directory         |
| `kb status`                                             | Project overview — page count, source count, last activity       |
| `kb ingest <source> [--apply] [--batch]`                | Process a source into the wiki (dry-run by default)              |
| `kb query <question> [--save <path>]`                   | Ask a question against the wiki                                  |
| `kb search <query> [--limit N] [--tags t1,t2] [--json]` | BM25 full-text search                                            |
| `kb lint [--deep]`                                      | Health-check the wiki for broken links, orphans, stale summaries |
| `kb index [--rebuild]`                                  | Rebuild the search index                                         |
| `kb log [--last N]`                                     | View recent activity                                             |
| `kb mcp`                                                | Start an MCP server (stdio) for agent integration                |
| `kb agent-context [--write]`                            | Generate a CLAUDE.md / AGENTS.md integration block               |

## Project Structure

Running `kb init` creates:

```
my-project/
├── .kb/
│   ├── config.toml       # Project configuration
│   ├── schema.md         # LLM instructions and wiki conventions
│   └── index.db          # SQLite FTS5 search index (auto-generated)
├── sources/              # Raw, immutable source materials
├── wiki/
│   └── _index.md         # Wiki root
└── log.md                # Append-only activity log
```

## Configuration

`.kb/config.toml`:

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

**Environment variables:**

| Variable            | Required for             |
| ------------------- | ------------------------ |
| `ANTHROPIC_API_KEY` | `provider = "anthropic"` |
| `OPENAI_API_KEY`    | `provider = "openai"`    |

## Ingest

`kb ingest` is dry-run by default — it shows what _would_ change without writing anything:

```bash
kb ingest paper.pdf
# Dry run — use --apply to write changes
#
# Source: paper.pdf → sources/paper.pdf
#
# Would create:
#   + wiki/sources/paper-summary.md
#   + wiki/concepts/new-concept.md
#
# Would update:
#   ~ wiki/overview.md
#
# Run with --apply to write these changes.

kb ingest paper.pdf --apply   # write changes
kb ingest sources/ --batch    # process all files in a directory
```

Supported source formats: Markdown, plain text, PDF, URLs.

## Search

```bash
kb search "authentication flow"
kb search "auth" --limit 5
kb search "auth" --tags security,api
kb search "auth" --json          # machine-readable output
```

## Query

```bash
kb query "What are the tradeoffs between REST and GraphQL?"
kb query "Summarize the auth system" --save wiki/summaries/auth.md
```

The `--save` flag writes the answer back into the wiki so knowledge compounds over time.

## Lint

```bash
kb lint
# ⚠  wiki/concepts/cqrs.md — Orphan page (no inbound links) [ORPHAN_PAGE]
# ⚠  wiki/architecture/overview.md → [[event-sourcing]] not found [BROKEN_LINK]
# ⚠  wiki/sources/q1-report-summary.md — Source updated after summary [STALE_SUMMARY]
# ℹ  wiki/concepts/stub.md — Stub page (no links, < 50 words) [STUB_PAGE]
# ℹ  wiki/concepts/api-gateway.md — Not in _index.md [MISSING_INDEX]
```

## MCP Integration

Start the MCP server and connect it to Claude Code or any MCP-compatible agent:

```bash
kb mcp
```

Available MCP tools: `kb_search`, `kb_get_page`, `kb_get_index`, `kb_list_sources`, `kb_ingest`, `kb_lint`, `kb_backlinks`, `kb_status`.

Generate a CLAUDE.md block for automatic agent integration:

```bash
kb agent-context --write   # appends to CLAUDE.md in project root
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

**Packages:**

| Package               | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `packages/core`       | Business logic — project model, indexer, search, ingest, query, lint |
| `packages/cli`        | Commander.js CLI                                                     |
| `packages/mcp-server` | MCP stdio server                                                     |

## Technology

- **Search**: SQLite FTS5 with BM25 ranking (`better-sqlite3`)
- **Markdown**: `remark` + `gray-matter` for parsing and frontmatter
- **LLM**: Anthropic SDK (OpenAI and Ollama via fetch)
- **MCP**: `@modelcontextprotocol/sdk`
- **Build**: TypeScript 5, tsup, vitest, Biome
