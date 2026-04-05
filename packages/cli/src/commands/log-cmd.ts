import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProject } from "@kb/core";

interface LogEntry {
  heading: string;
  body: string;
}

function parseLogEntries(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  // Split on lines starting with "## " (level-2 headings)
  const sections = content.split(/^(?=## )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    // Skip the top-level title (# Activity Log)
    if (trimmed.startsWith("# ")) continue;
    if (!trimmed.startsWith("## ")) continue;

    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) {
      entries.push({ heading: trimmed.slice(3).trim(), body: "" });
    } else {
      const heading = trimmed.slice(3, newlineIdx).trim();
      const body = trimmed.slice(newlineIdx + 1).trim();
      entries.push({ heading, body });
    }
  }

  return entries;
}

export function makeLogCommand(): Command {
  const cmd = new Command("log");

  cmd
    .description("Show recent activity log entries")
    .option("--last <n>", "number of entries to show", "10")
    .action(async (options: { last: string }) => {
      try {
        const project = await loadProject(process.cwd());
        const logPath = join(project.wikiDir, "log.md");

        let content: string;
        try {
          content = await readFile(logPath, "utf8");
        } catch {
          console.log(chalk.gray("No activity log found."));
          return;
        }

        const n = parseInt(options.last, 10);
        if (isNaN(n) || n < 1) {
          console.error(chalk.red("Error: --last must be a positive integer"));
          process.exit(1);
        }

        const entries = parseLogEntries(content);

        if (entries.length === 0) {
          console.log(chalk.gray("Activity log is empty."));
          return;
        }

        const last = entries.slice(-n);

        for (const entry of last) {
          console.log(chalk.bold(`## ${entry.heading}`));
          if (entry.body) {
            console.log(entry.body);
          }
          console.log();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
