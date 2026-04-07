import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
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
import type { Project, SearchResult } from "kb-core";

// ---------------------------------------------------------------------------
// Path safety helper
// ---------------------------------------------------------------------------

function assertWithinRoot(absPath: string, root: string): void {
  const resolvedPath = resolve(absPath);
  const resolvedRoot = resolve(root);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(resolvedRoot + "/")
  ) {
    throw new Error(
      `Unsafe path rejected: "${absPath}" is outside project root`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolSearch(
  project: Project,
  args: Record<string, unknown>,
): Promise<string> {
  const query = String(args.query ?? "");
  const limit = args.limit !== undefined ? Number(args.limit) : 10;
  const tags = Array.isArray(args.tags)
    ? (args.tags as string[])
    : args.tags
      ? [String(args.tags)]
      : undefined;

  const db = openDb(project);
  let results;
  try {
    results = await searchWiki(db, query, project.name, {
      limit,
      tags,
      searchConfig: project.config.search,
    });
  } finally {
    closeDb(db);
  }

  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.title}](${r.path})\n   Tags: ${r.tags.join(", ") || "(none)"}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

async function toolGetPage(
  project: Project,
  args: Record<string, unknown>,
): Promise<string> {
  const userPath = String(args.path ?? "");
  const absPath = join(project.root, userPath);
  assertWithinRoot(absPath, project.root);
  return await readFile(absPath, "utf8");
}

async function toolGetIndex(project: Project): Promise<string> {
  const indexPath = join(project.wikiDir, "_index.md");
  try {
    return await readFile(indexPath, "utf8");
  } catch {
    return "(No _index.md found)";
  }
}

async function toolListSources(project: Project): Promise<string> {
  let entries;
  try {
    entries = await readdir(project.sourcesDir, { withFileTypes: true });
  } catch {
    return "(Sources directory not found or empty)";
  }

  const files = entries.filter((e) => e.isFile() && e.name !== ".gitkeep");

  if (files.length === 0) {
    return "(No source files)";
  }

  const fileInfos = await Promise.all(
    files.map(async (e) => {
      const filePath = join(project.sourcesDir, e.name);
      const s = await stat(filePath);
      return {
        filename: e.name,
        size: s.size,
        mtime: s.mtime.toISOString(),
      };
    }),
  );

  return fileInfos
    .map((f) => `${f.filename}  size=${f.size}  mtime=${f.mtime}`)
    .join("\n");
}

async function toolIngest(
  project: Project,
  args: Record<string, unknown>,
): Promise<string> {
  const sourcePath = String(args.source_path ?? "");

  const llm = createLlmAdapter(project.config);

  const plan = await ingestSource(project, sourcePath, llm, { apply: false });

  const lines: string[] = [
    `DRY RUN — source: ${plan.sourceFile}`,
    `Summary page: ${plan.result.summary.path}`,
  ];

  if (plan.result.updates.length > 0) {
    lines.push(`Updates (${plan.result.updates.length}):`);
    for (const u of plan.result.updates) {
      lines.push(`  - ${u.path}: ${u.reason}`);
    }
  }

  if (plan.result.newPages.length > 0) {
    lines.push(`New pages (${plan.result.newPages.length}):`);
    for (const p of plan.result.newPages) {
      lines.push(`  - ${p.path}: ${p.reason}`);
    }
  }

  lines.push(`Log entry: ${plan.result.logEntry}`);

  return lines.join("\n");
}

async function toolLint(project: Project): Promise<string> {
  const result = await lintProject(project);

  const lines: string[] = [
    `Pages checked: ${result.pagesChecked}`,
    `Sources checked: ${result.sourcesChecked}`,
    `Issues: ${result.issues.length}`,
  ];

  if (result.issues.length === 0) {
    lines.push("No issues found.");
  } else {
    for (const issue of result.issues) {
      lines.push(
        `[${issue.severity.toUpperCase()}] ${issue.code}: ${issue.path} — ${issue.message}`,
      );
    }
  }

  return lines.join("\n");
}

async function toolBacklinks(
  project: Project,
  args: Record<string, unknown>,
): Promise<string> {
  const targetPath = String(args.path ?? "");

  const db = openDb(project);
  let rows: Array<{ path: string; outgoing_links: string }>;
  try {
    rows = db
      .prepare<
        [],
        { path: string; outgoing_links: string }
      >("SELECT path, outgoing_links FROM page_meta")
      .all();
  } finally {
    closeDb(db);
  }

  const backlinks: string[] = [];
  for (const row of rows) {
    let links: string[] = [];
    try {
      links = JSON.parse(row.outgoing_links) as string[];
    } catch {
      links = [];
    }
    const targetBasename = basename(targetPath, ".md");
    if (
      links.includes(targetPath) ||
      links.includes(targetBasename) ||
      links.some((l) => l === targetPath || l === targetBasename)
    ) {
      backlinks.push(row.path);
    }
  }

  if (backlinks.length === 0) {
    return `No pages link to "${targetPath}".`;
  }

  return backlinks.join("\n");
}

async function toolStatus(project: Project): Promise<string> {
  // Count wiki pages
  let pageCount = 0;
  try {
    const entries = await readdir(project.wikiDir, { recursive: true });
    pageCount = entries.filter(
      (f) => typeof f === "string" && f.endsWith(".md"),
    ).length;
  } catch {
    pageCount = 0;
  }

  // Count sources
  let sourceCount = 0;
  try {
    const entries = await readdir(project.sourcesDir, { withFileTypes: true });
    sourceCount = entries.filter(
      (e) => e.isFile() && e.name !== ".gitkeep",
    ).length;
  } catch {
    sourceCount = 0;
  }

  // Last log entry
  let lastLogEntry: string | null = null;
  try {
    const logContent = await readFile(join(project.root, "log.md"), "utf8");
    const lines = logContent.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = (lines[i] ?? "").trim();
      if (line.startsWith("## ")) {
        lastLogEntry = line.slice(3);
        break;
      }
    }
  } catch {
    // no log
  }

  const lines = [
    `name: ${project.name}`,
    `root: ${project.root}`,
    `pageCount: ${pageCount}`,
    `sourceCount: ${sourceCount}`,
    `lastLogEntry: ${lastLogEntry ?? "(none)"}`,
  ];

  return lines.join("\n");
}

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
  let results: SearchResult[];
  try {
    results = await searchAcrossProjects(
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

  if (results!.length === 0) return "No results found.";

  return results!
    .map(
      (r: SearchResult, i: number) =>
        `${i + 1}. [${r.project ?? ""}] [${r.title}](${r.path})\n   Tags: ${r.tags.join(", ") || "(none)"}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "kb_search",
    description: "Search wiki pages by full-text query",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "kb_get_page",
    description: "Get full content of a wiki page by path",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from project root (e.g. wiki/foo.md)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "kb_get_index",
    description: "Get wiki/_index.md content",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "kb_list_sources",
    description: "List source files with metadata",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "kb_ingest",
    description:
      "Dry-run ingest of a source file (shows plan without applying)",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_path: {
          type: "string",
          description: "Path to the source file to ingest",
        },
      },
      required: ["source_path"],
    },
  },
  {
    name: "kb_lint",
    description: "Run lint checks on the wiki",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "kb_backlinks",
    description: "Get pages that link to a given page",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Page path or name to find backlinks for",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "kb_status",
    description: "Get project metadata and status",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
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
];

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const project = await loadProject(process.cwd());

  const server = new Server(
    { name: "kb", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    try {
      let text: string;

      switch (name) {
        case "kb_search":
          text = await toolSearch(project, toolArgs);
          break;
        case "kb_get_page":
          text = await toolGetPage(project, toolArgs);
          break;
        case "kb_get_index":
          text = await toolGetIndex(project);
          break;
        case "kb_list_sources":
          text = await toolListSources(project);
          break;
        case "kb_ingest":
          text = await toolIngest(project, toolArgs);
          break;
        case "kb_lint":
          text = await toolLint(project);
          break;
        case "kb_backlinks":
          text = await toolBacklinks(project, toolArgs);
          break;
        case "kb_status":
          text = await toolStatus(project);
          break;
        case "kb_search_workspace":
          text = await toolSearchWorkspace(project, toolArgs);
          break;
        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
