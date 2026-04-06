# Phase 3: Multi-Project Workspaces & Cross-Project References

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-project dependency resolution, `[[kb://dep/path]]` link syntax, cross-project search and lint, workspace manifests, dep-aware ingest, and `kb deps` / `kb workspace` CLI commands.

**Architecture:** Dependency-first — `Project` gains a lazy `dependencies?: ResolvedDependency[]` field populated by `resolveDependencies()` in a new `deps.ts` module. A separate `workspace.ts` handles `.kbworkspace.toml` for workspace-wide operations. Most existing commands are unchanged; only cross-project commands invoke resolution.

**Tech Stack:** TypeScript, better-sqlite3, fast-glob (new dep), Node child_process.execFile (git — safe from shell injection, args passed as array), vitest, commander.js

---

## File Map

| Action | Path                                     | Responsibility                                                           |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| Modify | `packages/core/src/project.ts`           | Add `ResolvedDependency`, extend `Project.dependencies?`                 |
| Modify | `packages/core/src/markdown.ts`          | Parse `[[kb://...]]`, add `outgoingCrossLinks` to `ParsedPage`           |
| Modify | `packages/core/src/db.ts`                | Migration: add `outgoing_cross_links` column to `page_meta`              |
| Modify | `packages/core/src/indexer.ts`           | Store `outgoing_cross_links` in upsertMeta                               |
| Create | `packages/core/src/deps.ts`              | `resolveDependencies()`, git clone/cache, cycle detection                |
| Create | `packages/core/src/deps.test.ts`         | Tests for dependency resolution                                          |
| Create | `packages/core/src/workspace.ts`         | `WorkspaceConfig`, `Workspace`, `findWorkspaceRoot()`, `loadWorkspace()` |
| Create | `packages/core/src/workspace.test.ts`    | Tests for workspace discovery                                            |
| Modify | `packages/core/src/search.ts`            | Add `project?` to `SearchResult`, add `searchAcrossProjects()`           |
| Modify | `packages/core/src/lint.ts`              | Add `"error"` severity, two new cross-project link checks                |
| Modify | `packages/core/src/ingest.ts`            | Inject dep context into prompt, add write guard                          |
| Modify | `packages/core/src/index.ts`             | Export all new types and functions                                       |
| Create | `packages/cli/src/commands/deps.ts`      | `kb deps`, `kb deps update`                                              |
| Create | `packages/cli/src/commands/workspace.ts` | `kb workspace init`                                                      |
| Modify | `packages/cli/src/commands/search.ts`    | `--deps`, `--workspace`, `--project` flags                               |
| Modify | `packages/cli/src/commands/lint.ts`      | Display `"error"` severity in red                                        |
| Modify | `packages/cli/src/index.ts`              | Register deps and workspace commands                                     |
| Modify | `packages/mcp-server/src/index.ts`       | Add `kb_search_workspace` tool                                           |

---

## Task 1: Extend Project with ResolvedDependency

**Files:**

- Modify: `packages/core/src/project.ts`
- Modify (test): `packages/core/src/project.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/project.test.ts` (inside the existing `describe("loadProject")` block):

```typescript
it("loads project with dependencies field undefined by default", async () => {
  await setupKbProject(tmpDir);
  const project = await loadProject(tmpDir);
  expect(project.dependencies).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A5 "dependencies field"
```

Expected: FAIL — `project.dependencies` does not exist on the type.

- [ ] **Step 3: Implement — add ResolvedDependency and extend Project**

Replace the entire `packages/core/src/project.ts` with:

```typescript
import { access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { resolveConfig, type KbConfig } from "./config.js";

export interface ResolvedDependency {
  name: string;
  project: Project;
  mode: "readwrite" | "readonly";
}

export interface Project {
  name: string;
  root: string;
  kbDir: string;
  sourcesDir: string;
  wikiDir: string;
  config: KbConfig;
  dependencies?: ResolvedDependency[];
}

async function hasKbDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".kb", "config.toml"));
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir);

  while (true) {
    if (await hasKbDir(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function loadProject(startDir: string): Promise<Project> {
  const root = await findProjectRoot(startDir);
  if (root === null) {
    throw new Error(
      `No kb project found. Run "kb init" to initialize a knowledge base in the current directory.`,
    );
  }

  const kbDir = join(root, ".kb");
  const config = await resolveConfig(root);

  return {
    name: config.project.name,
    root,
    kbDir,
    sourcesDir: join(root, config.directories.sources),
    wikiDir: join(root, config.directories.wiki),
    config,
  };
}

export async function tryLoadProject(
  startDir: string,
): Promise<Project | null> {
  try {
    return await loadProject(startDir);
  } catch (err: unknown) {
    if (err instanceof Error && /no kb project found/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/project.ts packages/core/src/project.test.ts && git commit -m "feat(core): add ResolvedDependency type and extend Project with dependencies field"
```

---

## Task 2: Cross-Project Link Parsing, DB Migration, Indexer Update

**Files:**

- Modify: `packages/core/src/markdown.ts`
- Modify: `packages/core/src/db.ts`
- Modify: `packages/core/src/indexer.ts`
- Modify (test): `packages/core/src/markdown.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/src/markdown.test.ts` (at the end of the `describe("parsePage")` block):

```typescript
it("extracts cross-project kb:// links into outgoingCrossLinks", async () => {
  const filePath = join(tmpDir, "page.md");
  await writeFile(
    filePath,
    `# Test Page\n\nSee [[kb://shared-glossary/wiki/terms/api-gateway]] for details.\nAlso [[kb://company-standards/wiki/auth|Auth Standards]].\nAnd a regular link [[local-page]].\n`,
    "utf8",
  );
  const page = await parsePage(filePath, "wiki/page.md");
  expect(page.outgoingCrossLinks).toHaveLength(2);
  expect(page.outgoingCrossLinks[0]).toEqual({
    project: "shared-glossary",
    path: "wiki/terms/api-gateway",
  });
  expect(page.outgoingCrossLinks[1]).toEqual({
    project: "company-standards",
    path: "wiki/auth",
  });
});

it("does not include kb:// links in outgoingLinks", async () => {
  const filePath = join(tmpDir, "page.md");
  await writeFile(
    filePath,
    `# Test Page\n\n[[kb://shared-glossary/wiki/foo]]\n[[regular-link]]\n`,
    "utf8",
  );
  const page = await parsePage(filePath, "wiki/page.md");
  expect(page.outgoingLinks).toEqual(["regular-link"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "cross-project\|kb://"
```

Expected: FAIL — `outgoingCrossLinks` does not exist on `ParsedPage`.

- [ ] **Step 3: Update ParsedPage and markdown.ts**

Replace `packages/core/src/markdown.ts` with:

```typescript
import { readFile } from "node:fs/promises";
import matter from "gray-matter";

export interface CrossLink {
  project: string;
  path: string;
}

export interface ParsedPage {
  path: string;
  title: string;
  content: string;
  tags: string;
  frontmatter: Record<string, unknown>;
  outgoingLinks: string[];
  outgoingCrossLinks: CrossLink[];
  wordCount: number;
}

// Matches [[kb://project-name/path/to/page]] and [[kb://project-name/path/to/page|display]]
const CROSS_LINK_RE = /\[\[kb:\/\/([^/\]]+)\/([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
// Matches [[page-name]] and [[page-name|display]] — excludes kb:// prefixed links
const WIKILINK_RE = /\[\[(?!kb:\/\/)([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
const H1_RE = /^#\s+(.+)$/m;

function extractTitle(
  fm: Record<string, unknown>,
  content: string,
  relativePath: string,
): string {
  if (typeof fm["title"] === "string" && fm["title"].trim() !== "") {
    return fm["title"].trim();
  }
  const h1Match = H1_RE.exec(content);
  if (h1Match) {
    return h1Match[1]!.trim();
  }
  const filename = relativePath.split("/").pop() ?? relativePath;
  return filename.replace(/\.md$/i, "");
}

function extractTags(fm: Record<string, unknown>): string {
  const tags = fm["tags"];
  if (!Array.isArray(tags)) return "";
  return tags.filter((t): t is string => typeof t === "string").join(",");
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    links.push(match[1]!.trim());
  }
  return links;
}

function extractCrossLinks(content: string): CrossLink[] {
  const links: CrossLink[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CROSS_LINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    links.push({ project: match[1]!.trim(), path: match[2]!.trim() });
  }
  return links;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

export async function parsePage(
  filePath: string,
  relativePath: string,
  rawContent?: string,
): Promise<ParsedPage> {
  const raw = rawContent ?? (await readFile(filePath, "utf8"));
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const content = parsed.content;

  const title = extractTitle(fm, content, relativePath);
  const tags = extractTags(fm);
  const outgoingLinks = extractWikiLinks(content);
  const outgoingCrossLinks = extractCrossLinks(content);
  const wordCount = countWords(content);

  return {
    path: relativePath,
    title,
    content,
    tags,
    frontmatter: fm,
    outgoingLinks,
    outgoingCrossLinks,
    wordCount,
  };
}
```

- [ ] **Step 4: Update db.ts to migrate outgoing_cross_links column**

Replace `packages/core/src/db.ts` with:

```typescript
import Database from "better-sqlite3";
import { join } from "node:path";
import type { Project } from "./project.js";

const SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(
  path,
  title,
  content,
  tags,
  project,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS page_meta (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  frontmatter TEXT NOT NULL DEFAULT '{}',
  outgoing_links TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
`;

function migrateDb(db: Database.Database): void {
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(page_meta)")
    .all()
    .map((c) => c.name);

  if (!columns.includes("outgoing_cross_links")) {
    db.exec(
      "ALTER TABLE page_meta ADD COLUMN outgoing_cross_links TEXT NOT NULL DEFAULT '[]'",
    );
  }
}

export function openDb(project: Project): Database.Database {
  const dbPath = join(project.kbDir, "index.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  migrateDb(db);
  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}
```

- [ ] **Step 5: Update indexer.ts to store outgoing_cross_links**

In `packages/core/src/indexer.ts`, make two changes:

**a)** Replace the `upsertMeta` prepared statement (inside the `upsertStmts` object) with:

```typescript
      upsertMeta: db.prepare(`
        INSERT INTO page_meta(path, sha256, mtime, word_count, frontmatter, outgoing_links, outgoing_cross_links, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          word_count = excluded.word_count,
          frontmatter = excluded.frontmatter,
          outgoing_links = excluded.outgoing_links,
          outgoing_cross_links = excluded.outgoing_cross_links,
          updated_at = excluded.updated_at
      `),
```

**b)** Replace the `stmts.upsertMeta.run(...)` call in `upsertParsedPage` with:

```typescript
stmts.upsertMeta.run(
  page.path,
  hash,
  mtime,
  page.wordCount,
  JSON.stringify(page.frontmatter),
  JSON.stringify(page.outgoingLinks),
  JSON.stringify(page.outgoingCrossLinks),
  Date.now(),
);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/markdown.ts packages/core/src/markdown.test.ts packages/core/src/db.ts packages/core/src/indexer.ts && git commit -m "feat(core): parse kb:// cross-project links, migrate outgoing_cross_links column"
```

---

## Task 3: Dependency Resolution — Path Deps and Cycle Detection

**Files:**

- Create: `packages/core/src/deps.ts`
- Create: `packages/core/src/deps.test.ts`

- [ ] **Step 1: Install fast-glob**

```bash
cd /Users/loi/workspace/kb && pnpm add fast-glob --filter kb-core
```

Expected: fast-glob added to `packages/core/package.json` dependencies.

- [ ] **Step 2: Write failing tests**

Create `packages/core/src/deps.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDependencies } from "./deps.js";
import { loadProject } from "./project.js";

const baseConfig = (name: string, deps = "") => `
[project]
name = "${name}"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
${deps}
`;

async function setupKbProject(
  dir: string,
  name: string,
  deps = "",
): Promise<void> {
  await mkdir(join(dir, ".kb"), { recursive: true });
  await mkdir(join(dir, "sources"), { recursive: true });
  await mkdir(join(dir, "wiki"), { recursive: true });
  await writeFile(
    join(dir, ".kb", "config.toml"),
    baseConfig(name, deps),
    "utf8",
  );
}

describe("resolveDependencies", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-deps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when project has no dependencies", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    const deps = await resolveDependencies(project);
    expect(deps).toHaveLength(0);
    expect(project.dependencies).toEqual([]);
  });

  it("resolves a path dependency", async () => {
    const mainDir = join(tmpDir, "main");
    const depDir = join(tmpDir, "dep-a");
    await setupKbProject(
      mainDir,
      "main-project",
      `dep-a = { path = "../dep-a" }`,
    );
    await setupKbProject(depDir, "dep-a");

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);

    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("dep-a");
    expect(deps[0]!.project.name).toBe("dep-a");
    expect(deps[0]!.mode).toBe("readwrite");
  });

  it("respects readonly mode from config", async () => {
    const mainDir = join(tmpDir, "main");
    const depDir = join(tmpDir, "dep-a");
    await setupKbProject(
      mainDir,
      "main-project",
      `dep-a = { path = "../dep-a", mode = "readonly" }`,
    );
    await setupKbProject(depDir, "dep-a");

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);
    expect(deps[0]!.mode).toBe("readonly");
  });

  it("is idempotent — returns same array on repeated calls", async () => {
    await setupKbProject(tmpDir, "main-project");
    const project = await loadProject(tmpDir);
    const deps1 = await resolveDependencies(project);
    const deps2 = await resolveDependencies(project);
    expect(deps1).toBe(deps2);
  });

  it("detects dependency cycles", async () => {
    const aDir = join(tmpDir, "a");
    const bDir = join(tmpDir, "b");
    await setupKbProject(aDir, "project-a", `b = { path = "../b" }`);
    await setupKbProject(bDir, "project-b", `a = { path = "../a" }`);

    const project = await loadProject(aDir);
    await expect(resolveDependencies(project)).rejects.toThrow(/cycle/i);
  });

  it("handles diamond dependency without throwing", async () => {
    const aDir = join(tmpDir, "a");
    const bDir = join(tmpDir, "b");
    const cDir = join(tmpDir, "c");
    const sharedDir = join(tmpDir, "shared");
    await setupKbProject(sharedDir, "shared");
    await setupKbProject(bDir, "b", `shared = { path = "../shared" }`);
    await setupKbProject(cDir, "c", `shared = { path = "../shared" }`);
    await setupKbProject(
      aDir,
      "a",
      `b = { path = "../b" }\nc = { path = "../c" }`,
    );

    const project = await loadProject(aDir);
    const deps = await resolveDependencies(project);
    expect(deps).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "resolveDependencies"
```

Expected: FAIL — cannot find module `./deps.js`.

- [ ] **Step 4: Create deps.ts**

Create `packages/core/src/deps.ts`:

```typescript
import { resolve, join, dirname } from "node:path";
import { access, mkdir } from "node:fs/promises";
import type { Project, ResolvedDependency } from "./project.js";
import { loadProject } from "./project.js";

// NOTE: All git operations use execFile (not exec) to avoid shell injection.
// Arguments are passed as an array, never interpolated into a shell string.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function ensureGitDep(
  cacheDir: string,
  gitUrl: string,
  branch: string,
): Promise<void> {
  try {
    await access(join(cacheDir, ".kb", "config.toml"));
    return; // Cache exists — on-demand only, no re-pull
  } catch {
    await mkdir(dirname(cacheDir), { recursive: true });
    // Safe: args are array, not interpolated into shell
    await execFileAsync("git", [
      "clone",
      "--branch",
      branch,
      "--depth",
      "1",
      gitUrl,
      cacheDir,
    ]);
  }
}

export async function updateGitDep(
  project: Project,
  depName: string,
): Promise<void> {
  const cacheDir = join(project.kbDir, "cache", depName);
  // Safe: cacheDir is derived from project.kbDir (trusted), depName is a TOML key
  await execFileAsync("git", ["-C", cacheDir, "pull", "--ff-only"]);
}

async function resolveWithVisited(
  project: Project,
  visited: ReadonlySet<string>,
): Promise<void> {
  const entries = Object.entries(project.config.dependencies);
  project.dependencies = [];

  for (const [name, depConfig] of entries) {
    let depRoot: string;

    if (depConfig.path) {
      depRoot = resolve(project.root, depConfig.path);
    } else if (depConfig.git) {
      const branch = depConfig.branch ?? "main";
      const cacheDir = join(project.kbDir, "cache", name);
      await ensureGitDep(cacheDir, depConfig.git, branch);
      depRoot = resolve(cacheDir);
    } else {
      continue; // Unknown dep type — skip
    }

    if (visited.has(depRoot)) {
      const cyclePath = [...visited, depRoot].join(" → ");
      throw new Error(`Dependency cycle detected: ${cyclePath}`);
    }

    const depProject = await loadProject(depRoot);
    const childVisited = new Set([...visited, depRoot]);
    await resolveWithVisited(depProject, childVisited);

    const mode: ResolvedDependency["mode"] =
      depConfig.mode === "readonly" ? "readonly" : "readwrite";

    project.dependencies.push({ name, project: depProject, mode });
  }
}

export async function resolveDependencies(
  project: Project,
): Promise<ResolvedDependency[]> {
  if (project.dependencies !== undefined) {
    return project.dependencies;
  }
  await resolveWithVisited(project, new Set([resolve(project.root)]));
  return project.dependencies!;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/deps.ts packages/core/src/deps.test.ts packages/core/package.json pnpm-lock.yaml && git commit -m "feat(core): add resolveDependencies with path/git dep support and cycle detection"
```

---

## Task 4: Git Dependency Caching Tests

**Files:**

- Modify: `packages/core/src/deps.test.ts`

- [ ] **Step 1: Write failing git dep tests**

Add the following describe block at the end of `packages/core/src/deps.test.ts`:

```typescript
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFileCb);

describe("git dependency caching", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-git-deps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("clones a git dependency into .kb/cache/<name>/", async () => {
    // Create a local git repo to use as the "remote"
    const remoteDir = join(tmpDir, "remote-repo");
    await mkdir(join(remoteDir, ".kb"), { recursive: true });
    await mkdir(join(remoteDir, "sources"), { recursive: true });
    await mkdir(join(remoteDir, "wiki"), { recursive: true });
    await writeFile(
      join(remoteDir, ".kb", "config.toml"),
      baseConfig("remote-dep"),
      "utf8",
    );
    await execFileAsync("git", ["init"], { cwd: remoteDir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], {
      cwd: remoteDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], {
      cwd: remoteDir,
    });
    await execFileAsync("git", ["add", "."], { cwd: remoteDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: remoteDir });

    const mainDir = join(tmpDir, "main");
    await setupKbProject(
      mainDir,
      "main-project",
      `remote-dep = { git = "${remoteDir}", branch = "master" }`,
    );

    const project = await loadProject(mainDir);
    const deps = await resolveDependencies(project);

    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("remote-dep");

    const cacheDir = join(mainDir, ".kb", "cache", "remote-dep");
    await expect(
      access(join(cacheDir, ".kb", "config.toml")),
    ).resolves.toBeUndefined();
  });

  it("does not re-clone if cache already exists", async () => {
    const mainDir = join(tmpDir, "main2");
    await setupKbProject(
      mainDir,
      "main2",
      `cached-dep = { git = "https://invalid.example.com/repo", branch = "main" }`,
    );

    // Pre-create cache to simulate prior clone
    const cacheDir = join(mainDir, ".kb", "cache", "cached-dep");
    await mkdir(join(cacheDir, ".kb"), { recursive: true });
    await mkdir(join(cacheDir, "sources"), { recursive: true });
    await mkdir(join(cacheDir, "wiki"), { recursive: true });
    await writeFile(
      join(cacheDir, ".kb", "config.toml"),
      baseConfig("cached-dep"),
      "utf8",
    );

    const project = await loadProject(mainDir);
    // Should not attempt git clone (would fail with invalid URL)
    const deps = await resolveDependencies(project);
    expect(deps[0]!.name).toBe("cached-dep");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (deps.ts already handles git in Task 3)

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/deps.test.ts && git commit -m "test(core): add git dependency caching tests"
```

---

## Task 5: Workspace Types and Discovery

**Files:**

- Create: `packages/core/src/workspace.ts`
- Create: `packages/core/src/workspace.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/workspace.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findWorkspaceRoot,
  loadWorkspace,
  parseWorkspaceConfig,
} from "./workspace.js";

const baseProjectConfig = (name: string) => `
[project]
name = "${name}"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
`;

async function setupKbProject(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, ".kb"), { recursive: true });
  await mkdir(join(dir, "sources"), { recursive: true });
  await mkdir(join(dir, "wiki"), { recursive: true });
  await writeFile(
    join(dir, ".kb", "config.toml"),
    baseProjectConfig(name),
    "utf8",
  );
}

describe("parseWorkspaceConfig", () => {
  it("parses members array", () => {
    const config = parseWorkspaceConfig({
      workspace: { members: ["projects/*", "shared/*"] },
    });
    expect(config.workspace.members).toEqual(["projects/*", "shared/*"]);
  });

  it("throws if workspace.members is missing", () => {
    expect(() => parseWorkspaceConfig({ workspace: {} })).toThrow(/members/i);
  });
});

describe("findWorkspaceRoot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-workspace-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds .kbworkspace.toml in current directory", async () => {
    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      "[workspace]\nmembers = []\n",
      "utf8",
    );
    const root = await findWorkspaceRoot(tmpDir);
    expect(root).toBe(tmpDir);
  });

  it("walks up to find .kbworkspace.toml", async () => {
    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      "[workspace]\nmembers = []\n",
      "utf8",
    );
    const deepDir = join(tmpDir, "a", "b");
    await mkdir(deepDir, { recursive: true });
    const root = await findWorkspaceRoot(deepDir);
    expect(root).toBe(tmpDir);
  });

  it("returns null when no .kbworkspace.toml found", async () => {
    const root = await findWorkspaceRoot(tmpDir);
    expect(root).toBeNull();
  });
});

describe("loadWorkspace", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-workspace-load-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads workspace and discovers member projects", async () => {
    const projectsDir = join(tmpDir, "projects");
    await setupKbProject(join(projectsDir, "alpha"), "alpha");
    await setupKbProject(join(projectsDir, "beta"), "beta");

    await writeFile(
      join(tmpDir, ".kbworkspace.toml"),
      '[workspace]\nmembers = ["projects/*"]\n',
      "utf8",
    );

    const ws = await loadWorkspace(tmpDir);
    expect(ws.root).toBe(tmpDir);
    expect(ws.members).toHaveLength(2);
    const names = ws.members.map((p) => p.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "workspace"
```

Expected: FAIL — cannot find module `./workspace.js`.

- [ ] **Step 3: Create workspace.ts**

Create `packages/core/src/workspace.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { access } from "node:fs/promises";
import TOML from "@iarna/toml";
import fg from "fast-glob";
import { loadProject } from "./project.js";
import type { Project } from "./project.js";

export interface WorkspaceConfig {
  workspace: {
    members: string[];
  };
  defaults?: {
    llm?: { provider?: string; model?: string };
  };
}

export interface Workspace {
  root: string;
  config: WorkspaceConfig;
  members: Project[];
}

export function parseWorkspaceConfig(
  raw: Record<string, unknown>,
): WorkspaceConfig {
  const ws = raw["workspace"];
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) {
    throw new Error("Invalid workspace config: missing [workspace] section");
  }
  const wsObj = ws as Record<string, unknown>;
  if (!Array.isArray(wsObj["members"])) {
    throw new Error(
      "Invalid workspace config: workspace.members must be an array",
    );
  }
  const members = (wsObj["members"] as unknown[]).filter(
    (m): m is string => typeof m === "string",
  );

  const result: WorkspaceConfig = { workspace: { members } };

  const rawDefaults = (ws as Record<string, unknown>)["defaults"];
  if (
    rawDefaults &&
    typeof rawDefaults === "object" &&
    !Array.isArray(rawDefaults)
  ) {
    const d = rawDefaults as Record<string, unknown>;
    const llm = d["llm"];
    if (llm && typeof llm === "object" && !Array.isArray(llm)) {
      const l = llm as Record<string, unknown>;
      result.defaults = {
        llm: {
          ...(typeof l["provider"] === "string"
            ? { provider: l["provider"] }
            : {}),
          ...(typeof l["model"] === "string" ? { model: l["model"] } : {}),
        },
      };
    }
  }

  return result;
}

export async function findWorkspaceRoot(
  startDir: string,
): Promise<string | null> {
  let current = resolve(startDir);
  while (true) {
    try {
      await access(join(current, ".kbworkspace.toml"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function loadWorkspace(root: string): Promise<Workspace> {
  const configPath = join(root, ".kbworkspace.toml");
  const raw = await readFile(configPath, "utf8");
  const parsed = TOML.parse(raw) as Record<string, unknown>;
  const config = parseWorkspaceConfig(parsed);

  // Expand member globs: "projects/*" -> find "projects/*/.kb/config.toml"
  const patterns = config.workspace.members.map((m) => `${m}/.kb/config.toml`);
  const found =
    patterns.length > 0
      ? await fg(patterns, { cwd: root, onlyFiles: true })
      : [];

  // "projects/alpha/.kb/config.toml" -> project root is dirname(dirname(p))
  const members = await Promise.all(
    found.map((p) => {
      const projectRoot = join(root, dirname(dirname(p)));
      return loadProject(projectRoot);
    }),
  );

  return { root, config, members };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/workspace.ts packages/core/src/workspace.test.ts && git commit -m "feat(core): add workspace manifest types, findWorkspaceRoot, loadWorkspace"
```

---

## Task 6: Cross-Project Search

**Files:**

- Modify: `packages/core/src/search.ts`
- Modify (test): `packages/core/src/search.test.ts`

- [ ] **Step 1: Write failing test**

Read the top of the existing search test to check imports:

```bash
head -10 packages/core/src/search.test.ts
```

Add this describe block at the bottom of `packages/core/src/search.test.ts`:

```typescript
import Database from "better-sqlite3";
import { searchAcrossProjects } from "./search.js";

describe("searchAcrossProjects", () => {
  function makeInMemoryDb(
    projectName: string,
    rows: Array<{ path: string; title: string; content: string }>,
  ) {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(
        path, title, content, tags, project, tokenize='porter unicode61'
      );
    `);
    const insert = db.prepare(
      "INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(row.path, row.title, row.content, "", projectName);
    }
    return db;
  }

  it("merges results from multiple DBs and prefixes dep paths", () => {
    const db1 = makeInMemoryDb("proj-a", [
      {
        path: "wiki/foo.md",
        title: "Foo Page",
        content: "authentication flow details",
      },
    ]);
    const db2 = makeInMemoryDb("proj-b", [
      {
        path: "wiki/bar.md",
        title: "Bar Page",
        content: "authentication token",
      },
    ]);

    const results = searchAcrossProjects(
      [
        { db: db1, projectName: "proj-a", prefix: undefined },
        { db: db2, projectName: "proj-b", prefix: "proj-b" },
      ],
      "authentication",
      { limit: 10 },
    );

    db1.close();
    db2.close();

    expect(results.length).toBeGreaterThan(0);
    const proj2Result = results.find((r) => r.project === "proj-b");
    expect(proj2Result).toBeDefined();
    expect(proj2Result!.path).toBe("proj-b: wiki/bar.md");
  });

  it("returns results from current project with no prefix", () => {
    const db = makeInMemoryDb("main", [
      { path: "wiki/main.md", title: "Main Page", content: "authentication" },
    ]);

    const results = searchAcrossProjects(
      [{ db, projectName: "main", prefix: undefined }],
      "authentication",
      { limit: 5 },
    );
    db.close();

    expect(results[0]!.project).toBeUndefined();
    expect(results[0]!.path).toBe("wiki/main.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "searchAcrossProjects"
```

Expected: FAIL — `searchAcrossProjects` not exported.

- [ ] **Step 3: Update search.ts**

Add `project?: string` to `SearchResult` and add `searchAcrossProjects()` at the end of `packages/core/src/search.ts`.

**a)** Update `SearchResult`:

```typescript
export interface SearchResult {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  project?: string;
}
```

**b)** Add after `searchWiki`:

```typescript
export interface CrossProjectTarget {
  db: Database.Database;
  projectName: string;
  prefix?: string;
}

export function searchAcrossProjects(
  targets: CrossProjectTarget[],
  query: string,
  options?: SearchOptions,
): SearchResult[] {
  const limit = options?.limit ?? 10;
  const allResults: SearchResult[] = [];

  for (const { db, projectName, prefix } of targets) {
    const results = searchWiki(db, query, projectName, {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/search.ts packages/core/src/search.test.ts && git commit -m "feat(core): add searchAcrossProjects for cross-project search"
```

---

## Task 7: Cross-Project Lint Checks

**Files:**

- Modify: `packages/core/src/lint.ts`
- Modify (test): `packages/core/src/lint.test.ts`

- [ ] **Step 1: Write failing tests**

Read the top of `packages/core/src/lint.test.ts` to check existing imports, then add this describe block at the end:

```typescript
describe("cross-project link lint checks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-xlink-lint-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function setupProject(
    dir: string,
    name: string,
    deps = "",
  ): Promise<void> {
    await mkdir(join(dir, ".kb"), { recursive: true });
    await mkdir(join(dir, "sources"), { recursive: true });
    await mkdir(join(dir, "wiki"), { recursive: true });
    await writeFile(
      join(dir, ".kb", "config.toml"),
      `[project]\nname = "${name}"\nversion = "0.1.0"\n[directories]\nsources = "sources"\nwiki = "wiki"\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n[dependencies]\n${deps}`,
      "utf8",
    );
    await writeFile(join(dir, "wiki", "_index.md"), `# ${name}\n`, "utf8");
  }

  it("reports UNDECLARED_CROSS_LINK as error when dep is not in config", async () => {
    await setupProject(tmpDir, "main");
    await writeFile(
      join(tmpDir, "wiki", "page-a.md"),
      "# Page A\n\n[[kb://unknown-dep/wiki/foo]]\n",
      "utf8",
    );

    const project = await loadProject(tmpDir);
    const result = await lintProject(project);

    const issue = result.issues.find((i) => i.code === "UNDECLARED_CROSS_LINK");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("reports UNRESOLVABLE_CROSS_LINK as warning when dep declared but page missing", async () => {
    const depDir = join(tmpDir, "dep-a");
    await setupProject(depDir, "dep-a");
    await setupProject(tmpDir, "main", `dep-a = { path = "${depDir}" }`);
    await writeFile(
      join(tmpDir, "wiki", "page-a.md"),
      "# Page A\n\n[[kb://dep-a/wiki/nonexistent-page]]\n",
      "utf8",
    );

    const project = await loadProject(tmpDir);
    const result = await lintProject(project);

    const issue = result.issues.find(
      (i) => i.code === "UNRESOLVABLE_CROSS_LINK",
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });
});
```

Ensure `loadProject` and `lintProject` are imported at the top of the test file. Read the existing imports first:

```bash
head -5 packages/core/src/lint.test.ts
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "cross-project link"
```

Expected: FAIL — `UNDECLARED_CROSS_LINK` and `UNRESOLVABLE_CROSS_LINK` codes don't exist.

- [ ] **Step 3: Update lint.ts — add error severity and cross-project checks**

**a)** Change `LintSeverity` in `packages/core/src/lint.ts`:

```typescript
export type LintSeverity = "error" | "warning" | "info";
```

**b)** Add `outgoing_cross_links` to `PageMetaRow`:

```typescript
interface PageMetaRow {
  path: string;
  outgoing_links: string;
  outgoing_cross_links: string;
  word_count: number;
  mtime: number;
  updated_at: number;
}
```

**c)** Update the DB query to include the new column:

```typescript
rows = db
  .prepare<
    [],
    PageMetaRow
  >("SELECT path, outgoing_links, outgoing_cross_links, word_count, mtime, updated_at FROM page_meta")
  .all();
```

**d)** Add `resolveDependencies` import at the top of `lint.ts`:

```typescript
import { resolveDependencies } from "./deps.js";
```

**e)** Add `access` to the existing fs/promises import:

```typescript
import { readdir, stat, access } from "node:fs/promises";
```

**f)** Add the cross-project checks just before `return { issues, pagesChecked, sourcesChecked }`:

```typescript
// --- CHECK 6 & 7: CROSS-PROJECT LINK CHECKS ---
await resolveDependencies(project);
const declaredDepNames = new Set(Object.keys(project.config.dependencies));

for (const row of rows) {
  let crossLinks: Array<{ project: string; path: string }> = [];
  try {
    crossLinks = JSON.parse(row.outgoing_cross_links) as Array<{
      project: string;
      path: string;
    }>;
  } catch {
    crossLinks = [];
  }

  for (const link of crossLinks) {
    if (!declaredDepNames.has(link.project)) {
      issues.push({
        severity: "error",
        code: "UNDECLARED_CROSS_LINK",
        path: row.path,
        message: `Cross-project link to undeclared dependency "${link.project}"`,
        detail: `[[kb://${link.project}/${link.path}]]`,
      });
      continue;
    }

    const dep = project.dependencies?.find((d) => d.name === link.project);
    if (dep) {
      const targetAbs = join(dep.project.root, link.path);
      let exists = false;
      for (const candidate of [targetAbs, `${targetAbs}.md`]) {
        try {
          await access(candidate);
          exists = true;
          break;
        } catch {
          // try next
        }
      }
      if (!exists) {
        issues.push({
          severity: "warning",
          code: "UNRESOLVABLE_CROSS_LINK",
          path: row.path,
          message: `Cross-project link target not found: ${link.path} in "${link.project}"`,
          detail: `[[kb://${link.project}/${link.path}]]`,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/lint.ts packages/core/src/lint.test.ts && git commit -m "feat(core): add UNDECLARED_CROSS_LINK and UNRESOLVABLE_CROSS_LINK lint checks"
```

---

## Task 8: Dependency-Aware Ingest

**Files:**

- Modify: `packages/core/src/ingest.ts`
- Modify (test): `packages/core/src/ingest.test.ts`

- [ ] **Step 1: Write failing test**

Read the existing ingest test:

```bash
head -30 packages/core/src/ingest.test.ts
```

Add a new test (add the `LlmAdapter` import if not present):

```typescript
it("includes dep wiki index in LLM prompt when project has path dependencies", async () => {
  // Set up dep project
  const depDir = join(tmpDir, "dep-x");
  await mkdir(join(depDir, ".kb"), { recursive: true });
  await mkdir(join(depDir, "sources"), { recursive: true });
  await mkdir(join(depDir, "wiki"), { recursive: true });
  await writeFile(
    join(depDir, ".kb", "config.toml"),
    `[project]\nname = "dep-x"\nversion = "0.1.0"\n[directories]\nsources = "sources"\nwiki = "wiki"\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n[dependencies]\n`,
    "utf8",
  );
  await writeFile(
    join(depDir, "wiki", "_index.md"),
    "# Dep X Index\n\nThis is dep-x knowledge.",
    "utf8",
  );

  // Set up main project with dep-x declared
  const mainDir = join(tmpDir, "main-ingest");
  await mkdir(join(mainDir, ".kb"), { recursive: true });
  await mkdir(join(mainDir, "sources"), { recursive: true });
  await mkdir(join(mainDir, "wiki"), { recursive: true });
  await writeFile(join(mainDir, "wiki", "_index.md"), "# Main\n", "utf8");
  await writeFile(
    join(mainDir, ".kb", "config.toml"),
    `[project]\nname = "main-ingest"\nversion = "0.1.0"\n[directories]\nsources = "sources"\nwiki = "wiki"\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n[dependencies]\ndep-x = { path = "${depDir}" }\n`,
    "utf8",
  );

  const capturedMessages: string[] = [];
  const mockLlm: LlmAdapter = {
    complete: async (messages) => {
      capturedMessages.push(messages[0]!.content);
      return JSON.stringify({
        summary: { path: "wiki/sources/test-summary.md", content: "# Test" },
        updates: [],
        newPages: [],
        indexUpdate: "# Index",
        logEntry: "test ingest",
      });
    },
  };

  const { loadProject } = await import("./project.js");
  const project = await loadProject(mainDir);
  const sourceFile = join(tmpDir, "test-source.md");
  await writeFile(sourceFile, "# Source\n\nTest content.", "utf8");

  await ingestSource(project, sourceFile, mockLlm, { apply: false });

  expect(capturedMessages[0]).toContain("dep-x");
  expect(capturedMessages[0]).toContain("Dep X Index");
  expect(capturedMessages[0]).toContain("kb://dep-x");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test -- --reporter=verbose 2>&1 | grep -A3 "dep wiki index"
```

Expected: FAIL — dep context not in prompt.

- [ ] **Step 3: Update ingest.ts**

**a)** Add import at the top of `packages/core/src/ingest.ts`:

```typescript
import { resolveDependencies } from "./deps.js";
```

**b)** After the line `const schema = await readFileSafe(schemaPath);`, add:

```typescript
// 3.5 — Load dep context if project has declared dependencies
let depContext = "";
const depEntries = Object.entries(project.config.dependencies);
if (depEntries.length > 0) {
  await resolveDependencies(project);
  if (project.dependencies && project.dependencies.length > 0) {
    const depIndexes = await Promise.all(
      project.dependencies.map(async ({ name, project: dep }) => {
        const indexPath = join(dep.wikiDir, "_index.md");
        let indexContent: string;
        try {
          indexContent = await readFile(indexPath, "utf8");
        } catch {
          indexContent = "(no index)";
        }
        return `- ${name}:\n${indexContent}`;
      }),
    );
    depContext =
      `\n\n## Related Knowledge Bases\n` +
      depIndexes.join("\n\n") +
      `\n\nYou may reference these via [[kb://dep-name/path/to/page]] links in generated content. ` +
      `You must NOT propose updates to dependency wiki pages.`;
  }
}
```

**c)** Update the `userMessage` to include `depContext`:

```typescript
const userMessage = `## Wiki Schema
${schema}

## Current Wiki Index
${currentIndex}${depContext}

## New Source: ${sourceContent.filename}
${sourceContent.content}

Integrate this source into the wiki following the schema above.`;
```

**d)** Add write-guard validation after `const result = parseIngestResult(raw)`:

```typescript
// Validate all proposed paths are within the project root
const resolvedRoot = resolve(project.root) + "/";
for (const p of [
  result.summary.path,
  ...result.updates.map((u) => u.path),
  ...result.newPages.map((pg) => pg.path),
]) {
  const abs = resolve(join(project.root, p));
  if (!abs.startsWith(resolvedRoot)) {
    throw new Error(`LLM proposed write outside project root: "${p}"`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/ingest.ts packages/core/src/ingest.test.ts && git commit -m "feat(core): inject dep context into ingest prompt and add write guard"
```

---

## Task 9: Wire Core Exports

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update index.ts**

Replace `packages/core/src/index.ts` with:

```typescript
// Core package — business logic

export const VERSION = "0.1.0";

export { initProject } from "./init.js";
export type { InitOptions } from "./init.js";

export {
  parseConfig,
  parseProjectConfig,
  parseGlobalConfig,
  mergeConfigs,
  resolveConfig,
} from "./config.js";
export type { KbConfig, GlobalConfig } from "./config.js";

export { loadProject, tryLoadProject } from "./project.js";
export type { Project, ResolvedDependency } from "./project.js";

export { openDb, closeDb } from "./db.js";

export { parsePage } from "./markdown.js";
export type { ParsedPage, CrossLink } from "./markdown.js";

export { indexProject } from "./indexer.js";
export type { IndexStats } from "./indexer.js";

export { searchWiki, searchAcrossProjects } from "./search.js";
export type {
  SearchResult,
  SearchOptions,
  CrossProjectTarget,
} from "./search.js";

export { readSource } from "./source-reader.js";
export type { SourceContent, SourceType } from "./source-reader.js";

export { createLlmAdapter } from "./llm.js";
export type { LlmAdapter, LlmMessage } from "./llm.js";

export type { IngestResult } from "./ingest-types.js";

export { ingestSource } from "./ingest.js";
export type { IngestOptions, IngestPlan } from "./ingest.js";

export { queryWiki } from "./query.js";
export type { QueryResult, QueryOptions } from "./query.js";

export { lintProject } from "./lint.js";
export type { LintIssue, LintResult, LintSeverity } from "./lint.js";

export { parseLogEntries } from "./log-parser.js";
export type { ParsedLogEntry } from "./log-parser.js";

export { resolveDependencies, updateGitDep } from "./deps.js";

export {
  findWorkspaceRoot,
  loadWorkspace,
  parseWorkspaceConfig,
} from "./workspace.js";
export type { WorkspaceConfig, Workspace } from "./workspace.js";
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-core build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/index.ts && git commit -m "feat(core): export deps and workspace types/functions from index"
```

---

## Task 10: CLI `kb deps` and `kb deps update`

**Files:**

- Create: `packages/cli/src/commands/deps.ts`

- [ ] **Step 1: Create deps.ts CLI command**

Create `packages/cli/src/commands/deps.ts`:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import {
  loadProject,
  resolveDependencies,
  indexProject,
  updateGitDep,
} from "kb-core";
import type { ResolvedDependency } from "kb-core";

function printDepTree(deps: ResolvedDependency[], indent = 0): void {
  for (const dep of deps) {
    const prefix = "  ".repeat(indent);
    const modeTag =
      dep.mode === "readonly"
        ? chalk.gray("[readonly]")
        : chalk.green("[readwrite]");
    const sourceTag = dep.project.config.dependencies
      ? chalk.blue("[path]")
      : chalk.magenta("[git]");
    console.log(
      `${prefix}${chalk.cyan(dep.name)} ${modeTag} ${chalk.white(dep.project.root)}`,
    );
    if (dep.project.dependencies && dep.project.dependencies.length > 0) {
      printDepTree(dep.project.dependencies, indent + 1);
    }
  }
}

export function makeDepsCommand(): Command {
  const cmd = new Command("deps");
  cmd.description("Manage project dependencies");

  // Default: kb deps (show tree)
  cmd
    .command("show", { isDefault: true })
    .description("Show resolved dependency tree")
    .action(async () => {
      try {
        const project = await loadProject(process.cwd());
        const deps = await resolveDependencies(project);

        if (deps.length === 0) {
          console.log(
            chalk.gray("No dependencies declared in .kb/config.toml"),
          );
          return;
        }

        console.log(`\nDependencies for ${chalk.bold(project.name)}:\n`);
        printDepTree(deps);
        console.log();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  // kb deps update
  cmd
    .command("update")
    .description("Pull latest changes for all git-backed dependencies")
    .action(async () => {
      try {
        const project = await loadProject(process.cwd());
        const gitDeps = Object.entries(project.config.dependencies).filter(
          ([, cfg]) => !!cfg.git,
        );

        if (gitDeps.length === 0) {
          console.log(chalk.gray("No git dependencies to update."));
          return;
        }

        for (const [name] of gitDeps) {
          process.stdout.write(`Updating ${chalk.cyan(name)}... `);
          try {
            await updateGitDep(project, name);
            const cacheDir = join(project.kbDir, "cache", name);
            const { loadProject: lp } = await import("kb-core");
            const depProject = await lp(cacheDir);
            await indexProject(depProject);
            console.log(chalk.green("done"));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`failed: ${message}`));
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-tool build 2>&1 | tail -5
```

Expected: builds (command not yet wired — that's Task 12).

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/cli/src/commands/deps.ts && git commit -m "feat(cli): add kb deps and kb deps update commands"
```

---

## Task 11: CLI `kb workspace init`

**Files:**

- Create: `packages/cli/src/commands/workspace.ts`

- [ ] **Step 1: Create workspace CLI command**

Create `packages/cli/src/commands/workspace.ts`:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { loadWorkspace } from "kb-core";

export function makeWorkspaceCommand(): Command {
  const cmd = new Command("workspace");
  cmd.description("Manage workspace of multiple kb projects");

  cmd
    .command("init")
    .description("Create a .kbworkspace.toml in the current directory")
    .option(
      "--members <patterns>",
      "comma-separated glob patterns for member projects (e.g. projects/*,shared/*)",
    )
    .action(async (options: { members?: string }) => {
      try {
        const cwd = process.cwd();

        try {
          await access(join(cwd, ".kbworkspace.toml"));
          console.error(
            chalk.red(
              "Error: .kbworkspace.toml already exists in the current directory.",
            ),
          );
          process.exit(1);
        } catch {
          // File does not exist — proceed
        }

        const patterns = options.members
          ? options.members
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean)
          : ["projects/*"];

        const tomlContent =
          `[workspace]\n` +
          `members = [${patterns.map((p) => `"${p}"`).join(", ")}]\n`;

        await writeFile(join(cwd, ".kbworkspace.toml"), tomlContent, "utf8");
        console.log(
          chalk.green(
            `Created .kbworkspace.toml with members: ${patterns.join(", ")}`,
          ),
        );

        try {
          const ws = await loadWorkspace(cwd);
          if (ws.members.length === 0) {
            console.log(
              chalk.yellow(
                "\nNo member projects found yet. Create kb projects inside the member directories.",
              ),
            );
          } else {
            console.log(`\nDiscovered ${ws.members.length} member project(s):`);
            for (const m of ws.members) {
              console.log(`  ${chalk.cyan(m.name)} — ${m.root}`);
            }
          }
        } catch {
          // Ignore discovery errors
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-tool build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/cli/src/commands/workspace.ts && git commit -m "feat(cli): add kb workspace init command"
```

---

## Task 12: CLI search flags `--deps`, `--workspace`, `--project`

**Files:**

- Modify: `packages/cli/src/commands/search.ts`

- [ ] **Step 1: Replace search.ts with cross-project flag support**

Replace `packages/cli/src/commands/search.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadProject,
  indexProject,
  openDb,
  closeDb,
  searchWiki,
  searchAcrossProjects,
  resolveDependencies,
  findWorkspaceRoot,
  loadWorkspace,
} from "kb-core";
import type { SearchResult } from "kb-core";

function printResults(
  results: SearchResult[],
  query: string,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No results found for "${query}".`);
    return;
  }

  console.log(
    `\nFound ${results.length} result${results.length !== 1 ? "s" : ""} for "${query}":\n`,
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const projectBadge = r.project ? chalk.magenta(`[${r.project}] `) : "";
    console.log(
      `  ${chalk.bold(`${i + 1}.`)} ${projectBadge}${chalk.cyan(r.path)}`,
    );
    console.log(`     ${chalk.white(r.title)}`);
    if (r.snippet) console.log(`     ${chalk.gray(r.snippet)}`);
    if (r.tags.length > 0)
      console.log(`     ${chalk.yellow("Tags:")} ${r.tags.join(", ")}`);
    console.log();
  }
}

export function makeSearchCommand(): Command {
  const cmd = new Command("search");

  cmd
    .description("Search wiki pages using full-text search")
    .argument("<query>", "search query")
    .option("-l, --limit <n>", "maximum number of results", "10")
    .option("--json", "output results as JSON", false)
    .option("--tags <tags>", "filter by tags (comma-separated, AND logic)")
    .option(
      "--deps",
      "search current project and all declared dependencies",
      false,
    )
    .option("--workspace", "search all projects in the workspace", false)
    .option("--project <name>", "search a specific declared dependency by name")
    .action(
      async (
        query: string,
        options: {
          limit: string;
          json: boolean;
          tags?: string;
          deps: boolean;
          workspace: boolean;
          project?: string;
        },
      ) => {
        try {
          const limit = parseInt(options.limit, 10);
          if (isNaN(limit) || limit < 1) {
            console.error(
              chalk.red("Error: --limit must be a positive integer"),
            );
            process.exit(1);
          }

          const tags = options.tags
            ? options.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined;

          const searchOptions = { limit, tags };

          // ── Workspace-wide search ───────────────────────────────────
          if (options.workspace) {
            const wsRoot = await findWorkspaceRoot(process.cwd());
            if (!wsRoot) {
              console.error(
                chalk.red(
                  'No workspace found. Run "kb workspace init" to create one.',
                ),
              );
              process.exit(1);
            }
            const ws = await loadWorkspace(wsRoot);
            if (ws.members.length === 0) {
              console.log("No member projects found in workspace.");
              return;
            }
            const dbs = ws.members.map((m) => openDb(m));
            let results: SearchResult[];
            try {
              results = searchAcrossProjects(
                ws.members.map((m, i) => ({
                  db: dbs[i]!,
                  projectName: m.name,
                  prefix: m.name,
                })),
                query,
                searchOptions,
              );
            } finally {
              for (const db of dbs) closeDb(db);
            }
            printResults(results, query, options.json);
            return;
          }

          const project = await loadProject(process.cwd());

          // Auto-index if needed
          const dbPath = join(project.kbDir, "index.db");
          if (!existsSync(dbPath)) {
            if (!options.json)
              console.log("Index not found. Indexing wiki pages...");
            await indexProject(project);
          } else {
            const db = openDb(project);
            const countRow = db
              .prepare<
                [],
                { count: number }
              >("SELECT count(*) as count FROM pages")
              .get();
            closeDb(db);
            if (!countRow || countRow.count === 0) {
              if (!options.json)
                console.log("Index is empty. Indexing wiki pages...");
              await indexProject(project);
            }
          }

          // ── Single dep search ───────────────────────────────────────
          if (options.project) {
            await resolveDependencies(project);
            const dep = project.dependencies?.find(
              (d) => d.name === options.project,
            );
            if (!dep) {
              console.error(
                chalk.red(
                  `Dependency "${options.project}" not declared in .kb/config.toml.`,
                ),
              );
              process.exit(1);
            }
            const db = openDb(dep.project);
            let results: SearchResult[];
            try {
              results = searchWiki(
                db,
                query,
                dep.project.name,
                searchOptions,
              ).map((r) => ({
                ...r,
                path: `${dep.name}: ${r.path}`,
                project: dep.name,
              }));
            } finally {
              closeDb(db);
            }
            printResults(results, query, options.json);
            return;
          }

          // ── Deps search ─────────────────────────────────────────────
          if (options.deps) {
            await resolveDependencies(project);
            const targets = [
              {
                db: openDb(project),
                projectName: project.name,
                prefix: undefined as string | undefined,
              },
              ...(project.dependencies ?? []).map((d) => ({
                db: openDb(d.project),
                projectName: d.project.name,
                prefix: d.name,
              })),
            ];
            let results: SearchResult[];
            try {
              results = searchAcrossProjects(targets, query, searchOptions);
            } finally {
              for (const { db } of targets) closeDb(db);
            }
            printResults(results, query, options.json);
            return;
          }

          // ── Default single-project search ───────────────────────────
          const db = openDb(project);
          let results: SearchResult[];
          try {
            results = searchWiki(db, query, project.name, searchOptions);
          } finally {
            closeDb(db);
          }
          printResults(results, query, options.json);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(1);
        }
      },
    );

  return cmd;
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-tool build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/cli/src/commands/search.ts && git commit -m "feat(cli): add --deps, --workspace, --project flags to kb search"
```

---

## Task 13: Update Lint CLI for Error Severity

**Files:**

- Modify: `packages/cli/src/commands/lint.ts`

- [ ] **Step 1: Update lint.ts display for error severity**

Replace `packages/cli/src/commands/lint.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { loadProject, lintProject } from "kb-core";

export function makeLintCommand(): Command {
  const cmd = new Command("lint");

  cmd
    .description("Check wiki health for broken links, orphan pages, and more")
    .option("--deep", "LLM-assisted checks (Phase 2)", false)
    .action(async (options: { deep: boolean }) => {
      try {
        if (options.deep) {
          console.log(chalk.yellow("--deep requires LLM, not yet implemented"));
          return;
        }

        const project = await loadProject(process.cwd());
        console.log("Checking wiki health...\n");

        const result = await lintProject(project);

        if (result.issues.length === 0) {
          console.log(
            chalk.green(
              `✓ Wiki is healthy (${result.pagesChecked} pages checked)`,
            ),
          );
          return;
        }

        for (const issue of result.issues) {
          const code = chalk.gray(`[${issue.code}]`);
          if (issue.severity === "error") {
            console.log(
              `${chalk.red("✗")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
            );
          } else if (issue.severity === "warning") {
            if (issue.code === "BROKEN_LINK") {
              console.log(
                `${chalk.yellow("⚠")}  ${chalk.cyan(issue.path)} → [[${issue.detail}]] not found ${code}`,
              );
            } else {
              console.log(
                `${chalk.yellow("⚠")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
              );
            }
          } else {
            console.log(
              `${chalk.blue("ℹ")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
            );
          }
        }

        const errors = result.issues.filter(
          (i) => i.severity === "error",
        ).length;
        const warnings = result.issues.filter(
          (i) => i.severity === "warning",
        ).length;
        const infos = result.issues.filter((i) => i.severity === "info").length;

        const parts: string[] = [];
        if (errors > 0)
          parts.push(
            `${chalk.red(String(errors))} error${errors !== 1 ? "s" : ""}`,
          );
        if (warnings > 0)
          parts.push(
            `${chalk.yellow(String(warnings))} warning${warnings !== 1 ? "s" : ""}`,
          );
        if (infos > 0) parts.push(`${chalk.blue(String(infos))} info`);

        console.log(
          `\nFound ${parts.join(", ")}. Run with --deep for LLM-assisted checks.`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
```

- [ ] **Step 2: Build and test**

```bash
cd /Users/loi/workspace/kb && pnpm build 2>&1 | tail -10 && pnpm test 2>&1 | tail -10
```

Expected: builds succeed, all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/cli/src/commands/lint.ts && git commit -m "feat(cli): display error severity in red for cross-project link issues"
```

---

## Task 14: MCP `kb_search_workspace` Tool

**Files:**

- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Add imports to mcp-server/src/index.ts**

In `packages/mcp-server/src/index.ts`, add to the existing `kb-core` import:

```typescript
import {
  loadProject,
  openDb,
  closeDb,
  searchWiki,
  ingestSource,
  lintProject,
  createLlmAdapter,
  findWorkspaceRoot,
  loadWorkspace,
  searchAcrossProjects,
} from "kb-core";
```

- [ ] **Step 2: Add toolSearchWorkspace function**

Add after the `toolStatus` function:

```typescript
async function toolSearchWorkspace(
  project: Project,
  args: Record<string, unknown>,
): Promise<string> {
  const query = String(args.query ?? "");
  const limit = args.limit !== undefined ? Number(args.limit) : 10;

  if (!query) return "Error: query is required";

  const wsRoot = await findWorkspaceRoot(project.root);
  if (!wsRoot) {
    return 'No workspace found. Run "kb workspace init" to create one.';
  }

  const ws = await loadWorkspace(wsRoot);
  if (ws.members.length === 0) return "No member projects found in workspace.";

  const dbs = ws.members.map((m) => openDb(m));
  let results;
  try {
    results = searchAcrossProjects(
      ws.members.map((m, i) => ({
        db: dbs[i]!,
        projectName: m.name,
        prefix: m.name,
      })),
      query,
      { limit },
    );
  } finally {
    for (const db of dbs) closeDb(db);
  }

  if (results.length === 0) return "No results found.";

  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.project ?? ""}] [${r.title}](${r.path})\n   Tags: ${r.tags.join(", ") || "(none)"}\n   ${r.snippet}`,
    )
    .join("\n\n");
}
```

- [ ] **Step 3: Add kb_search_workspace to TOOLS array**

Add this entry to the `TOOLS` array before the closing `]`:

```typescript
  {
    name: "kb_search_workspace",
    description:
      "Search all projects in the workspace (requires .kbworkspace.toml at or above project root)",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
```

- [ ] **Step 4: Add case to switch statement**

In the `switch (name)` block, add after the `kb_status` case:

```typescript
        case "kb_search_workspace":
          text = await toolSearchWorkspace(project, toolArgs);
          break;
```

- [ ] **Step 5: Build**

```bash
cd /Users/loi/workspace/kb && pnpm --filter kb-mcp build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/mcp-server/src/index.ts && git commit -m "feat(mcp): add kb_search_workspace tool"
```

---

## Task 15: Wire CLI Index and Final Verification

**Files:**

- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Register deps and workspace commands**

Replace `packages/cli/src/index.ts` with:

```typescript
#!/usr/bin/env node
import { createRequire } from "module";
import { Command } from "commander";
import { makeInitCommand } from "./commands/init.js";
import { makeStatusCommand } from "./commands/status.js";
import { makeIndexCommand } from "./commands/index-cmd.js";
import { makeSearchCommand } from "./commands/search.js";
import { makeIngestCommand } from "./commands/ingest.js";
import { makeQueryCommand } from "./commands/query.js";
import { makeLogCommand } from "./commands/log-cmd.js";
import { makeLintCommand } from "./commands/lint.js";
import { makeMcpCommand } from "./commands/mcp.js";
import { makeAgentContextCommand } from "./commands/agent-context.js";
import { makeDepsCommand } from "./commands/deps.js";
import { makeWorkspaceCommand } from "./commands/workspace.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("kb")
  .description("LLM-maintained wiki for project knowledge management")
  .version(version);

program.addCommand(makeInitCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeIndexCommand());
program.addCommand(makeSearchCommand());
program.addCommand(makeIngestCommand());
program.addCommand(makeQueryCommand());
program.addCommand(makeLogCommand());
program.addCommand(makeLintCommand());
program.addCommand(makeMcpCommand());
program.addCommand(makeAgentContextCommand());
program.addCommand(makeDepsCommand());
program.addCommand(makeWorkspaceCommand());

program.parse(process.argv);
```

- [ ] **Step 2: Full build and test**

```bash
cd /Users/loi/workspace/kb && pnpm build 2>&1 | tail -15
```

Expected: all packages build.

```bash
cd /Users/loi/workspace/kb && pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Smoke tests**

```bash
# kb deps with no deps declared
node packages/cli/dist/index.js deps 2>&1
```

Expected: `No dependencies declared in .kb/config.toml`

```bash
# kb search --workspace without manifest
node packages/cli/dist/index.js search --workspace "test" 2>&1
```

Expected: `Error: No workspace found. Run "kb workspace init" to create one.`

```bash
# kb workspace --help
node packages/cli/dist/index.js workspace --help 2>&1
```

Expected: help text showing `init` subcommand.

- [ ] **Step 4: Final commit**

```bash
cd /Users/loi/workspace/kb && git add packages/cli/src/index.ts && git commit -m "feat(cli): register kb deps and kb workspace commands

Phase 3 complete — multi-project workspaces and cross-project references."
```
