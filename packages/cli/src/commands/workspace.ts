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
