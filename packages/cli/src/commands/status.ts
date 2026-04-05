import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { loadProject } from "@kb/core";

async function countWikiPages(wikiDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(wikiDir, { recursive: true });
  } catch {
    return 0;
  }
  return entries.filter((f) => f.endsWith(".md") && f !== "_index.md").length;
}

async function countSources(sourcesDir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(sourcesDir, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return 0;
  }
  return entries.filter((e) => e.isFile() && e.name !== ".gitkeep").length;
}

async function readLastLogEntry(logPath: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("## ")) {
      // Strip the "## " prefix
      return line.slice(3);
    }
  }
  return null;
}

export function makeStatusCommand() {
  const cmd = new Command("status");

  cmd.description("Show status of the current kb project").action(async () => {
    try {
      const project = await loadProject(process.cwd());
      const [wikiPages, sourceCount, lastEntry] = await Promise.all([
        countWikiPages(project.wikiDir),
        countSources(project.sourcesDir),
        readLastLogEntry(join(project.root, "log.md")),
      ]);

      console.log(
        `Project: ${chalk.bold(project.name)} ${chalk.dim(`(v${project.config.project.version})`)}`,
      );
      console.log(`Root:    ${chalk.dim(project.root)}`);
      console.log(`Wiki:    ${wikiPages} page${wikiPages !== 1 ? "s" : ""}`);
      console.log(
        `Sources: ${sourceCount} source${sourceCount !== 1 ? "s" : ""}`,
      );
      if (lastEntry !== null) {
        console.log(`Log:     Last entry: ${lastEntry}`);
      } else {
        console.log(`Log:     ${chalk.dim("(no entries)")}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

  return cmd;
}
