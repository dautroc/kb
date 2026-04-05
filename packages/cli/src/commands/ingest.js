import { Command } from "commander";
import chalk from "chalk";
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadProject, ingestSource, createLlmAdapter } from "@kb/core";
function printPlan(plan, sourcePath) {
    const sourceBase = basename(sourcePath);
    const sourceFilename = basename(plan.sourceFile);
    const { result } = plan;
    console.log(chalk.yellow("Dry run — use --apply to write changes\n"));
    console.log(`Source: ${chalk.cyan(sourceBase)} → ${chalk.cyan(`sources/${sourceFilename}`)}`);
    const hasChanges = result.newPages.length > 0 ||
        result.updates.length > 0 ||
        result.summary.path;
    if (!hasChanges) {
        console.log(chalk.gray("\nNo changes would be made."));
        return;
    }
    console.log(chalk.bold("\nWould create:"));
    console.log(`  ${chalk.green("+")} ${result.summary.path} ${chalk.gray("(new page)")}`);
    for (const p of result.newPages) {
        console.log(`  ${chalk.green("+")} ${p.path} ${chalk.gray(`(new page)`)}`);
    }
    if (result.updates.length > 0) {
        console.log(chalk.bold("\nWould update:"));
        for (const u of result.updates) {
            console.log(`  ${chalk.yellow("~")} ${u.path} ${chalk.gray(`(${u.reason})`)}`);
        }
    }
    console.log(`\nWould update index: ${chalk.cyan("wiki/_index.md")}`);
    console.log(`Log entry: ${chalk.gray(`"${result.logEntry}"`)}`);
    console.log(chalk.gray("\nRun with --apply to write these changes."));
}
function printApplied(plan, sourcePath) {
    const sourceBase = basename(sourcePath);
    const sourceFilename = basename(plan.sourceFile);
    const { result } = plan;
    console.log(`${chalk.green("✓")} Ingested ${chalk.cyan(sourceBase)} → ${chalk.cyan(`sources/${sourceFilename}`)}`);
    console.log(`  ${chalk.green("+")} ${result.summary.path}`);
    for (const p of result.newPages) {
        console.log(`  ${chalk.green("+")} ${p.path}`);
    }
    for (const u of result.updates) {
        console.log(`  ${chalk.yellow("~")} ${u.path}`);
    }
    console.log(`  ${chalk.yellow("~")} wiki/_index.md`);
    console.log(chalk.gray(`  Log: "${result.logEntry}"`));
}
async function collectFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => join(dirPath, e.name));
}
export function makeIngestCommand() {
    const cmd = new Command("ingest");
    cmd
        .description("Ingest a source document into the wiki using LLM")
        .argument("<source-path>", "path to file or URL to ingest")
        .option("--apply", "write changes to wiki (default: dry-run)", false)
        .option("--batch", "process all files in a directory", false)
        .action(async (sourcePath, options) => {
        try {
            const project = await loadProject(process.cwd());
            const llm = createLlmAdapter(project.config);
            let sources;
            if (options.batch) {
                const s = await stat(sourcePath);
                if (!s.isDirectory()) {
                    console.error(chalk.red("Error: --batch requires a directory path"));
                    process.exit(1);
                }
                sources = await collectFiles(sourcePath);
                if (sources.length === 0) {
                    console.log(chalk.gray("No files found in directory."));
                    return;
                }
            }
            else {
                sources = [sourcePath];
            }
            for (const src of sources) {
                if (options.batch) {
                    console.log(chalk.bold(`\nProcessing: ${basename(src)}`));
                }
                const plan = await ingestSource(project, src, llm, {
                    apply: options.apply,
                });
                if (plan.dryRun) {
                    printPlan(plan, src);
                }
                else {
                    printApplied(plan, src);
                }
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
//# sourceMappingURL=ingest.js.map