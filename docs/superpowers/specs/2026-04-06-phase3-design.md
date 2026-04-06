# Phase 3 Design: Multi-Project Workspaces & Cross-Project References

**Date:** 2026-04-06  
**Status:** Approved  
**Scope:** `kb` monorepo — `packages/core`, `packages/cli`, `packages/mcp-server`

---

## Overview

Phase 3 adds multi-project awareness to `kb`. Projects can declare dependencies on other kb projects (by local path or git URL), search across them, lint cross-project links, and reference their knowledge via a `[[kb://dep/path]]` link syntax. An optional workspace manifest (`.kbworkspace.toml`) enables workspace-wide operations across a collection of sibling projects.

---

## Architecture: Approach

**Dependency-first, workspace as thin layer.** The `Project` model is extended with a lazy `dependencies` field. A standalone `resolveDependencies()` function populates it on demand. Most existing commands are unchanged. Only cross-project commands invoke resolution. The workspace manifest is a separate concern used only by `--workspace` and `kb workspace init`.

---

## 1. Data Model

### 1.1 New types in `packages/core/src/`

**`WorkspaceConfig`** (new, in `workspace.ts`):

```typescript
export interface WorkspaceConfig {
  workspace: {
    members: string[]; // glob patterns, e.g. ["projects/*", "shared/*"]
  };
  defaults?: {
    llm?: { provider?: string; model?: string };
  };
}
```

**`ResolvedDependency`** (new, in `deps.ts`):

```typescript
export interface ResolvedDependency {
  name: string; // alias from [dependencies] key
  project: Project; // fully loaded Project for this dep
  mode: "readwrite" | "readonly"; // from config, default "readwrite"
}
```

**`Workspace`** (new, in `workspace.ts`):

```typescript
export interface Workspace {
  root: string;
  config: WorkspaceConfig;
  members: Project[]; // all discovered member projects (flat, no transitive deps)
}
```

### 1.2 `Project` extension

`Project` gains one optional field:

```typescript
export interface Project {
  // ... existing fields unchanged ...
  dependencies?: ResolvedDependency[]; // undefined until resolveDependencies() is called
}
```

### 1.3 `KbConfig` — no changes

The `dependencies` field already exists:

```typescript
dependencies: Record<
  string,
  { path?: string; git?: string; branch?: string; mode?: string }
>;
```

---

## 2. Dependency Resolution (`packages/core/src/deps.ts`)

### 2.1 Path dependencies

1. Resolve the declared path relative to the project root.
2. Validate `.kb/config.toml` exists at the target — error if not a kb project.
3. Call `loadProject()` on the target.
4. Attach as `ResolvedDependency` with `mode` from config (default `"readwrite"`).

### 2.2 Git dependencies

1. Cache location: `<project-root>/.kb/cache/<dep-name>/`
2. If cache missing: `git clone <url> --branch <branch> --depth 1 <cache-path>`
3. If cache exists: **no-op** (on-demand only — `kb deps update` refreshes).
4. Call `loadProject()` on the cached clone.

### 2.3 Cycle detection

Build a `visited: Set<string>` (by project root absolute path) during recursive resolution. If a project root is seen twice, throw:

```
Dependency cycle detected: project-a → project-b → project-a
```

### 2.4 `resolveDependencies(project: Project): Promise<ResolvedDependency[]>`

- Idempotent: if `project.dependencies` is already set, return it immediately.
- Mutates `project.dependencies` in place.
- Resolves all deps concurrently (Promise.all), but cycle detection uses a shared visited set passed through recursive calls.

---

## 3. Cross-Project Links & Lint

### 3.1 Link syntax

Extend `parsePage()` in `markdown.ts` to recognise:

```
[[kb://dep-name/path/to/page]]
[[kb://dep-name/path/to/page|display text]]
```

`ParsedPage` gains a new field:

```typescript
outgoing_cross_links: Array<{ project: string; path: string }>;
```

### 3.2 DB schema migration

`page_meta` gains a new column:

```sql
ALTER TABLE page_meta ADD COLUMN outgoing_cross_links TEXT NOT NULL DEFAULT '[]';
```

Applied in `openDb()` via a guard: `PRAGMA table_info(page_meta)` — add the column only if it's missing.

### 3.3 New `kb lint` checks

Both checks run only when `resolveDependencies()` has been called (lint always resolves deps before checking).

| Check                           | Condition                                                                    | Severity |
| ------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Undeclared cross-project link   | `[[kb://dep-name/...]]` where `dep-name` not in `config.toml [dependencies]` | error    |
| Unresolvable cross-project link | dep is declared but the target page path doesn't exist in dep's wiki         | warning  |

Existing static checks are unchanged.

---

## 4. Cross-Project Search

### 4.1 `kb search --deps`

Searches the current project plus its **direct** declared dependencies only (not transitive deps of deps).

1. Call `resolveDependencies(project)`.
2. Query current project's DB + each direct dep's DB **in parallel**.
3. Prefix dep results: `"dep-name: wiki/page.md"`.
4. Merge all result sets, sort by BM25 score descending, apply `--limit` to final list.

### 4.2 `kb search --workspace`

1. Walk up from `cwd` to find `.kbworkspace.toml` (same discovery pattern as `.kb/config.toml`).
2. Error if not found: `"No workspace found. Run kb workspace init."`
3. Expand member globs from the manifest root → collect all matching directories with `.kb/config.toml`.
4. Load each member project (without resolving their transitive deps).
5. Query all member DBs in parallel, merge + re-rank same as `--deps`.

### 4.3 `kb search --project <name>`

Search a single declared dependency by name only.

---

## 5. Workspace Manifest

### 5.1 `.kbworkspace.toml` format

```toml
[workspace]
members = ["projects/*", "shared/*"]

[workspace.defaults]
llm.provider = "anthropic"
llm.model = "claude-sonnet-4-20250514"
```

Placed at the workspace root (an ancestor of all member project directories).

### 5.2 `kb workspace init`

- Prompts for member glob patterns (or accepts `--members` flag).
- Writes `.kbworkspace.toml` at `cwd`.
- Discovers matching member projects and prints a confirmation list.

### 5.3 Workspace discovery

`findWorkspaceRoot(startDir)` — walk up from `startDir`, return first directory containing `.kbworkspace.toml`, or `null`.

---

## 6. Dependency-Aware Ingest

When `kb ingest` runs and the project has declared dependencies, `resolveDependencies()` is called first. Each dep's `wiki/_index.md` is read and injected into the LLM prompt:

```
You have access to these related knowledge bases:
- shared-glossary: [contents of wiki/_index.md]
- company-standards: [contents of wiki/_index.md]

You may reference these via [[kb://dep-name/path]] links in generated content.
You must NOT propose updates to dependency wiki pages.
```

Post-processing validation: any path in `IngestResult.updates` or `newPages` that resolves outside the current project root is rejected with an error.

---

## 7. New CLI Commands

| Command             | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `kb deps`           | Print resolved dependency tree (name, source type, mode)     |
| `kb deps update`    | `git pull --ff-only` for each git dep's cache, then re-index |
| `kb workspace init` | Create `.kbworkspace.toml` at cwd                            |

---

## 8. New MCP Tool

**`kb_search_workspace`** — workspace-wide search. Only available when a workspace manifest is found at or above the project root. Returns the same shape as `kb_search` with an additional `project` field on each result.

---

## 9. File Layout

### New files

```
packages/core/src/
  deps.ts            # resolveDependencies(), git clone/cache logic, cycle detection
  deps.test.ts
  workspace.ts       # Workspace type, findWorkspaceRoot(), loadWorkspace(), parseWorkspaceConfig()
  workspace.test.ts

packages/cli/src/commands/
  deps.ts            # kb deps, kb deps update
  workspace.ts       # kb workspace init
```

### Modified files

| File                                  | Change                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `packages/core/src/project.ts`        | Add `dependencies?: ResolvedDependency[]` to `Project`                 |
| `packages/core/src/markdown.ts`       | Parse `[[kb://...]]` links, add `outgoing_cross_links` to `ParsedPage` |
| `packages/core/src/db.ts`             | Schema migration for `outgoing_cross_links` column                     |
| `packages/core/src/lint.ts`           | Two new cross-project link checks                                      |
| `packages/core/src/ingest.ts`         | Inject dep context into LLM prompt; validate no dep paths in result    |
| `packages/core/src/search.ts`         | Accept multi-DB query for cross-project search                         |
| `packages/core/src/index.ts`          | Export new types and functions                                         |
| `packages/cli/src/commands/search.ts` | Add `--deps`, `--workspace`, `--project` flags                         |
| `packages/cli/src/index.ts`           | Register new commands                                                  |
| `packages/mcp-server/src/index.ts`    | Add `kb_search_workspace` tool                                         |

---

## 10. Deliverables Checklist

- [ ] `.kbworkspace.toml` manifest and workspace discovery
- [ ] Dependency declaration in `config.toml` (path + git)
- [ ] Git dependency cloning and caching
- [ ] `[[kb://project/path]]` link parser and resolver
- [ ] Cross-project search (`--deps`, `--workspace`, `--project`)
- [ ] Cross-project broken link detection in `kb lint`
- [ ] MCP `kb_search_workspace` tool
- [ ] `kb deps` — show dependency tree
- [ ] `kb deps update` — pull latest for git dependencies
- [ ] `kb workspace init` — create workspace manifest
- [ ] Dependency-aware ingest (dep index injection + write guard)
