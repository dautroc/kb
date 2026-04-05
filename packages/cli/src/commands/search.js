import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadProject, indexProject, openDb, closeDb, searchWiki, } from "@kb/core";
export function makeSearchCommand() {
    const cmd = new Command("search");
    cmd
        .description("Search wiki pages using full-text search")
        .argument("<query>", "search query")
        .option("-l, --limit <n>", "maximum number of results", "10")
        .option("--json", "output results as JSON", false)
        .option("--tags <tags>", "filter by tags (comma-separated, AND logic)")
        .action(async (query, options) => {
        try {
            const project = await loadProject(process.cwd());
            // Auto-index if DB doesn't exist or is empty
            const dbPath = join(project.kbDir, "index.db");
            if (!existsSync(dbPath)) {
                if (!options.json) {
                    console.log("Index not found. Indexing wiki pages...");
                }
                await indexProject(project);
            }
            else {
                // Check if pages table is empty
                const db = openDb(project);
                const countRow = db
                    .prepare("SELECT count(*) as count FROM pages")
                    .get();
                closeDb(db);
                if (!countRow || countRow.count === 0) {
                    if (!options.json) {
                        console.log("Index is empty. Indexing wiki pages...");
                    }
                    await indexProject(project);
                }
            }
            const limit = parseInt(options.limit, 10);
            if (isNaN(limit) || limit < 1) {
                console.error(chalk.red("Error: --limit must be a positive integer"));
                process.exit(1);
            }
            const tags = options.tags
                ? options.tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0)
                : undefined;
            const db = openDb(project);
            let results;
            try {
                results = searchWiki(db, query, project.name, { limit, tags });
            }
            finally {
                closeDb(db);
            }
            if (options.json) {
                console.log(JSON.stringify(results, null, 2));
                return;
            }
            if (results.length === 0) {
                console.log(`No results found for "${query}".`);
                return;
            }
            console.log(`\nFound ${results.length} result${results.length !== 1 ? "s" : ""} for "${query}":\n`);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                console.log(`  ${chalk.bold(`${i + 1}.`)} ${chalk.cyan(r.path)}`);
                console.log(`     ${chalk.white(r.title)}`);
                if (r.snippet) {
                    console.log(`     ${chalk.gray(r.snippet)}`);
                }
                if (r.tags.length > 0) {
                    console.log(`     ${chalk.yellow("Tags:")} ${r.tags.join(", ")}`);
                }
                console.log();
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });
    return cmd;
}
//# sourceMappingURL=search.js.map