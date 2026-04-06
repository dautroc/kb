import { Command } from "commander";
import chalk from "chalk";
import { loadProject, lintProject } from "kb-core";

export function makeLintCommand(): Command {
  const cmd = new Command("lint");

  cmd
    .description("Check wiki health for broken links, orphan pages, and more")
    .option("--deep", "LLM-assisted checks (Phase 2)", false)
    .action(async (options: { deep: boolean }) => {
      try {
        if (options.deep) {
          console.log(chalk.yellow("--deep requires LLM, not yet implemented"));
          return;
        }

        const project = await loadProject(process.cwd());
        console.log("Checking wiki health...\n");

        const result = await lintProject(project);

        if (result.issues.length === 0) {
          console.log(
            chalk.green(
              `✓ Wiki is healthy (${result.pagesChecked} pages checked)`,
            ),
          );
          return;
        }

        for (const issue of result.issues) {
          const code = chalk.gray(`[${issue.code}]`);
          if (issue.severity === "error") {
            console.log(
              `${chalk.red("✗")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
            );
          } else if (issue.severity === "warning") {
            if (issue.code === "BROKEN_LINK" && issue.detail != null) {
              console.log(
                `${chalk.yellow("⚠")}  ${chalk.cyan(issue.path)} → [[${issue.detail}]] not found ${code}`,
              );
            } else {
              console.log(
                `${chalk.yellow("⚠")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
              );
            }
          } else {
            console.log(
              `${chalk.blue("ℹ")}  ${chalk.cyan(issue.path)} — ${issue.message} ${code}`,
            );
          }
        }

        const errors = result.issues.filter(
          (i) => i.severity === "error",
        ).length;
        const warnings = result.issues.filter(
          (i) => i.severity === "warning",
        ).length;
        const infos = result.issues.filter((i) => i.severity === "info").length;

        const parts: string[] = [];
        if (errors > 0)
          parts.push(
            `${chalk.red(String(errors))} error${errors !== 1 ? "s" : ""}`,
          );
        if (warnings > 0)
          parts.push(
            `${chalk.yellow(String(warnings))} warning${warnings !== 1 ? "s" : ""}`,
          );
        if (infos > 0) parts.push(`${chalk.blue(String(infos))} info`);

        console.log(
          `\nFound ${parts.join(", ")}. Run with --deep for LLM-assisted checks.`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
