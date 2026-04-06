import { resolve, join, dirname } from "node:path";
import { access, mkdir } from "node:fs/promises";
import type { Project, ResolvedDependency } from "./project.js";
import { loadProject } from "./project.js";
// NOTE: execFile (not exec) is used for git — args passed as array, not shell-interpolated
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function ensureGitDep(
  cacheDir: string,
  gitUrl: string,
  branch: string,
): Promise<void> {
  try {
    await access(join(cacheDir, ".git"));
    return; // Cache exists — on-demand only, no re-pull
  } catch {
    await mkdir(dirname(cacheDir), { recursive: true });
    // Safe: args are array, never shell-interpolated
    await execFileAsync("git", [
      "clone",
      "--branch",
      branch,
      "--depth",
      "1",
      gitUrl,
      cacheDir,
    ]);
  }
}

export async function updateGitDep(
  project: Project,
  depName: string,
): Promise<void> {
  if (
    depName.includes("/") ||
    depName.includes("\\") ||
    depName.includes("..")
  ) {
    throw new Error(`Invalid dependency name: "${depName}"`);
  }
  const cacheDir = join(project.kbDir, "cache", depName);
  // Safe: cacheDir derived from project.kbDir (trusted), depName is a TOML key
  await execFileAsync("git", ["-C", cacheDir, "pull", "--ff-only"]);
}

async function resolveWithVisited(
  project: Project,
  visited: ReadonlySet<string>,
): Promise<ResolvedDependency[]> {
  const entries = Object.entries(project.config.dependencies);
  const resolved: ResolvedDependency[] = [];

  for (const [name, depConfig] of entries) {
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new Error(`Invalid dependency name: "${name}"`);
    }

    let depRoot: string;

    if (depConfig.path) {
      depRoot = resolve(project.root, depConfig.path);
    } else if (depConfig.git) {
      const branch = depConfig.branch ?? "main";
      const cacheDir = join(project.kbDir, "cache", name);
      await ensureGitDep(cacheDir, depConfig.git, branch);
      depRoot = resolve(cacheDir);
    } else {
      continue; // Unknown dep type — skip
    }

    if (visited.has(depRoot)) {
      const cyclePath = [...visited, depRoot].join(" → ");
      throw new Error(`Dependency cycle detected: ${cyclePath}`);
    }

    const depProject = await loadProject(depRoot);
    const childVisited = new Set([...visited, depRoot]);
    await resolveDependencies(depProject, childVisited);

    const mode: ResolvedDependency["mode"] =
      depConfig.mode === "readonly" ? "readonly" : "readwrite";

    resolved.push({ name, project: depProject, mode });
  }

  return resolved;
}

export async function resolveDependencies(
  project: Project,
  visited?: ReadonlySet<string>,
): Promise<ResolvedDependency[]> {
  if (project.dependencies !== undefined) {
    return project.dependencies;
  }
  const effectiveVisited = visited ?? new Set([resolve(project.root)]);
  project.dependencies = await resolveWithVisited(project, effectiveVisited);
  return project.dependencies;
}
