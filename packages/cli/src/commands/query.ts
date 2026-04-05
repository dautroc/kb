import { Command } from "commander";
import chalk from "chalk";
import { loadProject, queryWiki, createLlmAdapter } from "kb-core";

export function makeQueryCommand(): Command {
  const cmd = new Command("query");

  cmd
    .description("Ask a question about the wiki knowledge base")
    .argument("<question>", "question to ask")
    .option("--save <path>", "save answer as a wiki page at the given path")
    .action(async (question: string, options: { save?: string }) => {
      try {
        const project = await loadProject(process.cwd());
        const llm = createLlmAdapter(project.config);

        const result = await queryWiki(project, question, llm, {
          save: options.save,
        });

        console.log(result.answer);

        if (result.sources.length > 0) {
          console.log(
            `\n${chalk.gray("Sources:")} ${result.sources.join(", ")}`,
          );
        }

        if (options.save) {
          console.log(chalk.green(`\nSaved to ${options.save}`));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
