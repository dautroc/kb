# kb (knowledge base)

A CLI tool that implements [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for project knowledge management. Each project gets an isolated, LLM-maintained wiki. The LLM summarizes, cross-references, and maintains — the human curates sources and asks questions.

## Install

```bash
npm install -g kb-tool
```

Or run directly:

```bash
npx kb-tool init
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

| Command                                                                                  | Description                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `kb init [name]`                                                                         | Initialize a new knowledge base in the current directory         |
| `kb status`                                                                              | Project overview — page count, source count, last activity       |
| `kb ingest <source> [--apply] [--batch]`                                                 | Process a source into the wiki (dry-run by default)              |
| `kb query <question> [--save <path>]`                                                    | Ask a question against the wiki                                  |
| `kb search <query> [--limit N] [--tags t1,t2] [--deps] [--workspace] [--project <name>]` | BM25 full-text search (optionally across deps or workspace)      |
| `kb lint [--deep]`                                                                       | Health-check the wiki for broken links, orphans, stale summaries |
| `kb index [--rebuild]`                                                                   | Rebuild the search index                                         |
| `kb log [--last N]`                                                                      | View recent activity                                             |
| `kb deps`                                                                                | Show resolved dependency tree                                    |
| `kb deps update`                                                                         | Pull latest changes for all git-backed dependencies              |
| `kb workspace init [--members <globs>]`                                                  | Create a `.kbworkspace.toml` workspace manifest                  |
| `kb mcp`                                                                                 | Start an MCP server (stdio) for agent integration                |
| `kb agent-context [--write]`                                                             | Generate a CLAUDE.md / AGENTS.md integration block               |

> For detailed per-command reference, configuration options, best practices, and troubleshooting see **[docs/usage-guide.md](docs/usage-guide.md)**.

## Multi-Project Workspaces

`kb` supports declaring dependencies on other kb projects and searching/linking across them.

### Declaring dependencies

In `.kb/config.toml`:

```toml
[dependencies]
shared-glossary = { path = "../shared-glossary" }
company-standards = { git = "https://github.com/org/standards.git", branch = "main" }
```

### Cross-project links

Reference pages in dependencies using `[[kb://dep-name/path/to/page]]` syntax:

```markdown
See [[kb://shared-glossary/wiki/concepts/api-gateway]] for details.
See [[kb://shared-glossary/wiki/concepts/api-gateway|API Gateway]] for a named link.
```

`kb lint` reports `UNDECLARED_CROSS_LINK` (error) for unknown dep names and `UNRESOLVABLE_CROSS_LINK` (warning) for missing target pages.

### Cross-project search

```bash
kb search "auth" --deps            # current project + all declared deps
kb search "auth" --project shared-glossary  # single dep only
kb search "auth" --workspace       # all projects in .kbworkspace.toml
```

### Workspace manifest

```bash
kb workspace init --members "projects/*,shared/*"
```

Creates `.kbworkspace.toml` at the current directory:

```toml
[workspace]
members = ["projects/*", "shared/*"]
```

### Dependency commands

```bash
kb deps              # show resolved dependency tree with modes
kb deps update       # git pull --ff-only for all git-backed deps
```

---

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
provider = "anthropic"          # anthropic | openai | ollama | zai
model = "claude-sonnet-4-20250514"

[dependencies]
# shared-glossary = { path = "../shared-glossary" }
```

**Environment variables:**

| Variable            | Required for             |
| ------------------- | ------------------------ |
| `ANTHROPIC_API_KEY` | `provider = "anthropic"` |
| `OPENAI_API_KEY`    | `provider = "openai"`    |
| `ZAI_API_KEY`       | `provider = "zai"`       |

**Z.AI provider example:**

```toml
[llm]
provider = "zai"
model = "glm-4-flash"   # or any model available on z.ai
```

```bash
export ZAI_API_KEY="your-zai-api-key"
```

Z.AI uses an OpenAI-compatible chat completions API (`https://api.z.ai/api/paas/v4/chat/completions`).

## MCP Integration

`kb` ships a built-in MCP server that exposes all wiki operations to any MCP-compatible agent (Claude Code, Claude Desktop, Cursor, etc.).

### Available tools

| Tool                  | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `kb_search`           | BM25 full-text search across wiki pages                             |
| `kb_search_workspace` | Search all projects in the workspace (requires `.kbworkspace.toml`) |
| `kb_get_page`         | Read the full content of a wiki page                                |
| `kb_get_index`        | Read `wiki/_index.md`                                               |
| `kb_list_sources`     | List source files with size and modification time                   |
| `kb_ingest`           | Dry-run ingest of a source file (shows plan)                        |
| `kb_lint`             | Run health checks on the wiki                                       |
| `kb_backlinks`        | Find all pages that link to a given page                            |
| `kb_status`           | Project overview — page count, source count, etc.                   |

### Add to Claude Code (session)

```bash
claude mcp add kb -- npx kb-tool mcp
```

Or, if installed globally:

```bash
claude mcp add kb -- kb mcp
```

The server must be started from the directory that contains your `.kb/config.toml`. If your knowledge base lives in a subdirectory, pass the path:

```bash
claude mcp add kb -- sh -c "cd /path/to/kb-project && kb mcp"
```

### Add to Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "kb": {
      "command": "kb",
      "args": ["mcp"],
      "cwd": "/path/to/your/kb-project",
      "env": {
        "ANTHROPIC_API_KEY": "your-key-here"
      }
    }
  }
}
```

If you use Z.AI as the provider, replace the env entry:

```json
"env": {
  "ZAI_API_KEY": "your-zai-key-here"
}
```

### Generate a CLAUDE.md integration block

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
