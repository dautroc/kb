import { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import {
  loadProject,
  resolveDependencies,
  indexProject,
  updateGitDep,
} from "kb-core";
import type { ResolvedDependency } from "kb-core";

function printDepTree(deps: ResolvedDependency[], indent = 0): void {
  for (const dep of deps) {
    const prefix = "  ".repeat(indent);
    const modeTag =
      dep.mode === "readonly"
        ? chalk.gray("[readonly]")
        : chalk.green("[readwrite]");
    console.log(
      `${prefix}${chalk.cyan(dep.name)} ${modeTag} ${chalk.white(dep.project.root)}`,
    );
    if (dep.project.dependencies && dep.project.dependencies.length > 0) {
      printDepTree(dep.project.dependencies, indent + 1);
    }
  }
}

export function makeDepsCommand(): Command {
  const cmd = new Command("deps");
  cmd.description("Manage project dependencies");

  cmd
    .command("show", { isDefault: true })
    .description("Show resolved dependency tree")
    .action(async () => {
      try {
        const project = await loadProject(process.cwd());
        const deps = await resolveDependencies(project);

        if (deps.length === 0) {
          console.log(
            chalk.gray("No dependencies declared in .kb/config.toml"),
          );
          return;
        }

        console.log(`\nDependencies for ${chalk.bold(project.name)}:\n`);
        printDepTree(deps);
        console.log();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  cmd
    .command("update")
    .description("Pull latest changes for all git-backed dependencies")
    .action(async () => {
      try {
        const project = await loadProject(process.cwd());
        const gitDeps = Object.entries(project.config.dependencies).filter(
          ([, cfg]) => !!cfg.git,
        );

        if (gitDeps.length === 0) {
          console.log(chalk.gray("No git dependencies to update."));
          return;
        }

        for (const [name] of gitDeps) {
          process.stdout.write(`Updating ${chalk.cyan(name)}... `);
          try {
            await updateGitDep(project, name);
            const cacheDir = join(project.kbDir, "cache", name);
            const { loadProject: lp } = await import("kb-core");
            const depProject = await lp(cacheDir);
            await indexProject(depProject);
            console.log(chalk.green("done"));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`failed: ${message}`));
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
