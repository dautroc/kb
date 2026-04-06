import { readFile, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import TOML from "@iarna/toml";
import fg from "fast-glob";
import { loadProject } from "./project.js";
import type { Project } from "./project.js";

export interface WorkspaceConfig {
  workspace: {
    members: string[];
  };
  defaults?: {
    llm?: { provider?: string; model?: string };
  };
}

export interface Workspace {
  root: string;
  config: WorkspaceConfig;
  members: Project[];
}

export function parseWorkspaceConfig(
  raw: Record<string, unknown>,
): WorkspaceConfig {
  const ws = raw["workspace"];
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) {
    throw new Error("Invalid workspace config: missing [workspace] section");
  }
  const wsObj = ws as Record<string, unknown>;
  if (!Array.isArray(wsObj["members"])) {
    throw new Error(
      "Invalid workspace config: workspace.members must be an array",
    );
  }
  const members = (wsObj["members"] as unknown[]).filter(
    (m): m is string => typeof m === "string",
  );

  const result: WorkspaceConfig = { workspace: { members } };

  const rawDefaults = raw["defaults"];
  if (
    rawDefaults &&
    typeof rawDefaults === "object" &&
    !Array.isArray(rawDefaults)
  ) {
    const d = rawDefaults as Record<string, unknown>;
    const llm = d["llm"];
    if (llm && typeof llm === "object" && !Array.isArray(llm)) {
      const l = llm as Record<string, unknown>;
      result.defaults = {
        llm: {
          ...(typeof l["provider"] === "string"
            ? { provider: l["provider"] }
            : {}),
          ...(typeof l["model"] === "string" ? { model: l["model"] } : {}),
        },
      };
    }
  }

  return result;
}

export async function findWorkspaceRoot(
  startDir: string,
): Promise<string | null> {
  let current = resolve(startDir);
  while (true) {
    try {
      await access(join(current, ".kbworkspace.toml"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function loadWorkspace(root: string): Promise<Workspace> {
  const configPath = join(root, ".kbworkspace.toml");
  const raw = await readFile(configPath, "utf8");
  const parsed = TOML.parse(raw) as Record<string, unknown>;
  const config = parseWorkspaceConfig(parsed);

  // Expand member globs: "projects/*" -> find "projects/*/.kb/config.toml"
  const patterns = config.workspace.members.map((m) => `${m}/.kb/config.toml`);
  const found =
    patterns.length > 0
      ? await fg(patterns, { cwd: root, onlyFiles: true })
      : [];

  // "projects/alpha/.kb/config.toml" -> project root is dirname(dirname(relativePath))
  const members = await Promise.all(
    found.map((p) => {
      const projectRoot = join(root, dirname(dirname(p)));
      return loadProject(projectRoot);
    }),
  );

  return { root, config, members };
}
