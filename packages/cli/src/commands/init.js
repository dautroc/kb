import { Command } from "commander";
import { basename, resolve } from "node:path";
import chalk from "chalk";
import { initProject } from "@kb/core";
export function makeInitCommand() {
    const cmd = new Command("init");
    cmd
        .description("Initialize a new knowledge base in the current directory")
        .argument("[project-name]", "Name of the project (defaults to directory name)")
        .action(async (projectName) => {
        const directory = resolve(process.cwd());
        const name = projectName ?? basename(directory);
        try {
            await initProject({ name, directory });
            console.log(chalk.green(`✓ Knowledge base initialized: ${name}`));
            console.log("");
            console.log(chalk.dim("Created:"));
            console.log(chalk.dim("  .kb/config.toml    — project manifest"));
            console.log(chalk.dim("  .kb/schema.md      — LLM instructions"));
            console.log(chalk.dim("  sources/           — raw source materials"));
            console.log(chalk.dim("  wiki/_index.md     — wiki root"));
            console.log(chalk.dim("  log.md             — activity log"));
            console.log("");
            console.log(chalk.cyan(`Run ${chalk.bold("kb ingest <source>")} to add content.`));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });
    return cmd;
}
//# sourceMappingURL=init.js.map