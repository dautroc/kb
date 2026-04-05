import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { loadProject } from "@kb/core";

export async function readSchemaLines(schemaPath: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(schemaPath, "utf8");
  } catch {
    return "_No `.kb/schema.md` found in this project._";
  }
  const lines = content.split("\n").slice(0, 20);
  return lines.join("\n");
}

export async function buildBlock(
  projectName: string,
  schemaLines: string,
): Promise<string> {
  return `## Knowledge Base: ${projectName}

This project has an LLM-maintained knowledge base at \`./wiki/\`.
- Wiki index: \`wiki/_index.md\`
- Schema/conventions: \`.kb/schema.md\`
- Raw sources: \`sources/\`
- Activity log: \`log.md\`

### Available CLI commands
- \`kb search <query>\` — Search the wiki
- \`kb ingest <path> --apply\` — Process a new source into the wiki
- \`kb query <question>\` — Ask a question against the wiki
- \`kb lint\` — Health-check the wiki
- \`kb lint --deep\` — LLM-assisted deep health check

### MCP tools available
This project exposes an MCP server via \`kb mcp\`.
Tools: kb_search, kb_get_page, kb_get_index, kb_ingest, kb_lint, kb_backlinks, kb_status.

### Wiki conventions
${schemaLines}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function makeAgentContextCommand(): Command {
  const cmd = new Command("agent-context");

  cmd
    .description("Generate a markdown context block for CLAUDE.md / AGENTS.md")
    .option("--write", "Append block to CLAUDE.md in project root", false)
    .action(async (options: { write: boolean }) => {
      try {
        const project = await loadProject(process.cwd());
        const schemaPath = join(project.root, ".kb", "schema.md");
        const schemaLines = await readSchemaLines(schemaPath);
        const block = await buildBlock(project.name, schemaLines);

        if (!options.write) {
          console.log(block);
          return;
        }

        const claudeMdPath = join(project.root, "CLAUDE.md");
        const exists = await fileExists(claudeMdPath);

        if (exists) {
          const existing = await readFile(claudeMdPath, "utf8");
          await writeFile(claudeMdPath, `${existing}\n---\n${block}`, "utf8");
        } else {
          await writeFile(claudeMdPath, block, "utf8");
        }

        console.log(chalk.green("Written to CLAUDE.md"));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
