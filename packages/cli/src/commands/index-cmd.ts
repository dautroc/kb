import { Command } from "commander";
import chalk from "chalk";
import { loadProject, indexProject } from "kb-core";

export function makeIndexCommand(): Command {
  const cmd = new Command("index");

  cmd
    .description("Index wiki pages into the search database")
    .option("--rebuild", "delete all entries and re-index from scratch", false)
    .action(async (options: { rebuild: boolean }) => {
      try {
        const project = await loadProject(process.cwd());
        console.log("Indexing wiki pages...");

        const stats = await indexProject(project, options.rebuild);

        const updated = stats.indexed;
        const unchanged = stats.skipped;
        const total = updated + unchanged;

        const details: string[] = [];
        if (updated > 0) details.push(`${updated} updated`);
        if (unchanged > 0) details.push(`${unchanged} unchanged`);
        if (stats.deleted > 0) details.push(`${stats.deleted} deleted`);
        if (stats.errors > 0) details.push(`${stats.errors} errors`);

        const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
        console.log(
          `${chalk.green("✓")} Indexed ${total} page${total !== 1 ? "s" : ""}${detailStr}`,
        );

        if (stats.embedStats) {
          const es = stats.embedStats;
          if (es.ollamaUnavailable) {
            console.warn(
              chalk.yellow("⚠  Ollama not reachable — skipping embeddings"),
            );
          } else {
            console.log(
              chalk.green(
                `✓ Embedded ${es.embedded} page(s) (${es.skipped} skipped)`,
              ),
            );
          }
        }

        if (stats.errors > 0) {
          process.exit(1);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
