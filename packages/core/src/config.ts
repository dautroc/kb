import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";

export interface KbConfig {
  project: {
    name: string;
    version: string;
  };
  directories: {
    sources: string;
    wiki: string;
  };
  llm: {
    provider: "anthropic" | "openai" | "ollama" | "zai";
    model: string;
  };
  dependencies: Record<
    string,
    { path?: string; git?: string; branch?: string; mode?: string }
  >;
}

export type GlobalConfig = {
  project?: { name?: string; version?: string };
  directories?: { sources?: string; wiki?: string };
  llm?: { provider?: KbConfig["llm"]["provider"]; model?: string };
  dependencies?: KbConfig["dependencies"];
};

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "zai"] as const;

export async function parseGlobalConfig(path?: string): Promise<GlobalConfig> {
  const resolvedPath = path ?? join(homedir(), ".kb", "config.toml");

  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch {
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid TOML in global config file ${resolvedPath}: ${message}`,
    );
  }

  const result: GlobalConfig = {};

  const rawProject = parsed["project"];
  if (
    rawProject !== undefined &&
    typeof rawProject === "object" &&
    !Array.isArray(rawProject)
  ) {
    const p = rawProject as Record<string, unknown>;
    result.project = {
      ...(typeof p["name"] === "string" ? { name: p["name"] } : {}),
      ...(typeof p["version"] === "string" ? { version: p["version"] } : {}),
    };
  }

  const rawDirectories = parsed["directories"];
  if (
    rawDirectories !== undefined &&
    typeof rawDirectories === "object" &&
    !Array.isArray(rawDirectories)
  ) {
    const d = rawDirectories as Record<string, unknown>;
    result.directories = {
      ...(typeof d["sources"] === "string" ? { sources: d["sources"] } : {}),
      ...(typeof d["wiki"] === "string" ? { wiki: d["wiki"] } : {}),
    };
  }

  const rawLlm = parsed["llm"];
  if (
    rawLlm !== undefined &&
    typeof rawLlm === "object" &&
    !Array.isArray(rawLlm)
  ) {
    const l = rawLlm as Record<string, unknown>;
    result.llm = {
      ...(typeof l["provider"] === "string" &&
      (VALID_PROVIDERS as readonly string[]).includes(l["provider"])
        ? { provider: l["provider"] as KbConfig["llm"]["provider"] }
        : {}),
      ...(typeof l["model"] === "string" ? { model: l["model"] } : {}),
    };
  }

  const rawDeps = parsed["dependencies"];
  if (
    rawDeps !== undefined &&
    typeof rawDeps === "object" &&
    !Array.isArray(rawDeps)
  ) {
    const dependencies: KbConfig["dependencies"] = {};
    for (const [depKey, depVal] of Object.entries(
      rawDeps as Record<string, unknown>,
    )) {
      if (
        typeof depVal === "object" &&
        depVal !== null &&
        !Array.isArray(depVal)
      ) {
        const dep = depVal as Record<string, unknown>;
        dependencies[depKey] = {
          ...(typeof dep["path"] === "string" ? { path: dep["path"] } : {}),
          ...(typeof dep["git"] === "string" ? { git: dep["git"] } : {}),
          ...(typeof dep["branch"] === "string"
            ? { branch: dep["branch"] }
            : {}),
          ...(typeof dep["mode"] === "string" ? { mode: dep["mode"] } : {}),
        };
      }
    }
    result.dependencies = dependencies;
  }

  return result;
}

export async function parseProjectConfig(
  configPath: string,
): Promise<GlobalConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Config file not found: ${configPath}\n${message}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid TOML in config file ${configPath}: ${message}`);
  }

  const result: GlobalConfig = {};

  const rawProject = parsed["project"];
  if (
    rawProject !== undefined &&
    typeof rawProject === "object" &&
    !Array.isArray(rawProject)
  ) {
    const p = rawProject as Record<string, unknown>;
    result.project = {
      ...(typeof p["name"] === "string" ? { name: p["name"] } : {}),
      ...(typeof p["version"] === "string" ? { version: p["version"] } : {}),
    };
  }

  const rawDirectories = parsed["directories"];
  if (
    rawDirectories !== undefined &&
    typeof rawDirectories === "object" &&
    !Array.isArray(rawDirectories)
  ) {
    const d = rawDirectories as Record<string, unknown>;
    result.directories = {
      ...(typeof d["sources"] === "string" ? { sources: d["sources"] } : {}),
      ...(typeof d["wiki"] === "string" ? { wiki: d["wiki"] } : {}),
    };
  }

  const rawLlm = parsed["llm"];
  if (
    rawLlm !== undefined &&
    typeof rawLlm === "object" &&
    !Array.isArray(rawLlm)
  ) {
    const l = rawLlm as Record<string, unknown>;
    result.llm = {
      ...(typeof l["provider"] === "string"
        ? { provider: l["provider"] as KbConfig["llm"]["provider"] }
        : {}),
      ...(typeof l["model"] === "string" ? { model: l["model"] } : {}),
    };
  }

  const rawDeps = parsed["dependencies"];
  if (
    rawDeps !== undefined &&
    typeof rawDeps === "object" &&
    !Array.isArray(rawDeps)
  ) {
    const dependencies: KbConfig["dependencies"] = {};
    for (const [depKey, depVal] of Object.entries(
      rawDeps as Record<string, unknown>,
    )) {
      if (
        typeof depVal === "object" &&
        depVal !== null &&
        !Array.isArray(depVal)
      ) {
        const dep = depVal as Record<string, unknown>;
        dependencies[depKey] = {
          ...(typeof dep["path"] === "string" ? { path: dep["path"] } : {}),
          ...(typeof dep["git"] === "string" ? { git: dep["git"] } : {}),
          ...(typeof dep["branch"] === "string"
            ? { branch: dep["branch"] }
            : {}),
          ...(typeof dep["mode"] === "string" ? { mode: dep["mode"] } : {}),
        };
      }
    }
    result.dependencies = dependencies;
  }

  return result;
}

export function mergeConfigs(
  global: GlobalConfig,
  project: GlobalConfig,
): KbConfig {
  const projectSection = { ...global.project, ...project.project };
  const directories = { ...global.directories, ...project.directories };
  const llm = { ...global.llm, ...project.llm };
  const dependencies = { ...global.dependencies, ...project.dependencies };

  const hint = " — set it in ~/.kb/config.toml or .kb/config.toml";

  if (!projectSection.name?.trim()) {
    throw new Error(`Missing required field "project.name"${hint}`);
  }
  if (!projectSection.version?.trim()) {
    throw new Error(`Missing required field "project.version"${hint}`);
  }
  if (!directories.sources?.trim()) {
    throw new Error(`Missing required field "directories.sources"${hint}`);
  }
  if (!directories.wiki?.trim()) {
    throw new Error(`Missing required field "directories.wiki"${hint}`);
  }
  if (!llm.provider) {
    throw new Error(`Missing required field "llm.provider"${hint}`);
  }
  if (!(VALID_PROVIDERS as readonly string[]).includes(llm.provider)) {
    throw new Error(
      `Invalid config: llm.provider must be one of ${VALID_PROVIDERS.join(", ")}, got "${llm.provider}"`,
    );
  }
  if (!llm.model?.trim()) {
    throw new Error(`Missing required field "llm.model"${hint}`);
  }

  if (
    directories.sources.startsWith("/") ||
    directories.sources.split("/").includes("..")
  ) {
    throw new Error(
      `Invalid config: directories.sources must be a safe relative path, got "${directories.sources}"`,
    );
  }
  if (
    directories.wiki.startsWith("/") ||
    directories.wiki.split("/").includes("..")
  ) {
    throw new Error(
      `Invalid config: directories.wiki must be a safe relative path, got "${directories.wiki}"`,
    );
  }

  return {
    project: { name: projectSection.name, version: projectSection.version },
    directories: { sources: directories.sources, wiki: directories.wiki },
    llm: {
      provider: llm.provider as KbConfig["llm"]["provider"],
      model: llm.model,
    },
    dependencies: dependencies ?? {},
  };
}

/** @deprecated Use resolveConfig(projectDir) instead */
export async function parseConfig(configPath: string): Promise<KbConfig> {
  const project = await parseProjectConfig(configPath);
  return mergeConfigs({}, project);
}
