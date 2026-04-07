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

  const modeBadge =
    results[0]?.searchMode === "hybrid" ? chalk.cyan(" [hybrid]") : "";

  console.log(
    `\nFound ${results.length} result${results.length !== 1 ? "s" : ""} for "${query}"${modeBadge}:\n`,
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

          // ── Workspace-wide search ─────────────────────────────────────
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
              results = await searchAcrossProjects(
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

          // ── Single dep search ──────────────────────────────────────────
          if (options.project) {
            const resolvedDeps = await resolveDependencies(project);
            const dep = resolvedDeps.find((d) => d.name === options.project);
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
              results = (
                await searchWiki(db, query, dep.project.name, searchOptions)
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

          // ── Deps search ────────────────────────────────────────────────
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
              results = await searchAcrossProjects(
                targets,
                query,
                searchOptions,
              );
            } finally {
              for (const { db } of targets) closeDb(db);
            }
            printResults(results, query, options.json);
            return;
          }

          // ── Default single-project search ──────────────────────────────
          const db = openDb(project);
          let results: SearchResult[];
          try {
            results = await searchWiki(db, query, project.name, {
              ...searchOptions,
              searchConfig: project.config.search,
            });
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
