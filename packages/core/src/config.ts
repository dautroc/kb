import { readFile } from "node:fs/promises";
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

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "zai"] as const;

function requireSafeRelativePath(val: string, field: string): void {
  if (val.startsWith("/") || val.split("/").includes("..")) {
    throw new Error(
      `Invalid config: ${field} must be a safe relative path, got "${val}"`,
    );
  }
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const val = obj[key];
  if (typeof val !== "string" || val.trim() === "") {
    throw new Error(
      `Invalid config: missing required field "${context}.${key}"`,
    );
  }
  return val;
}

function requireSection(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const val = obj[key];
  if (
    val === undefined ||
    val === null ||
    typeof val !== "object" ||
    Array.isArray(val)
  ) {
    throw new Error(`Invalid config: missing required section "[${key}]"`);
  }
  return val as Record<string, unknown>;
}

export async function parseConfig(configPath: string): Promise<KbConfig> {
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

  const project = requireSection(parsed, "project");
  const name = requireString(project, "name", "project");
  const version = requireString(project, "version", "project");

  const directories = requireSection(parsed, "directories");
  const sources = requireString(directories, "sources", "directories");
  requireSafeRelativePath(sources, "directories.sources");
  const wiki = requireString(directories, "wiki", "directories");
  requireSafeRelativePath(wiki, "directories.wiki");

  const llm = requireSection(parsed, "llm");
  const providerRaw = requireString(llm, "provider", "llm");
  if (!(VALID_PROVIDERS as readonly string[]).includes(providerRaw)) {
    throw new Error(
      `Invalid config: llm.provider must be one of ${VALID_PROVIDERS.join(", ")}, got "${providerRaw}"`,
    );
  }
  const provider = providerRaw as KbConfig["llm"]["provider"];
  const model = requireString(llm, "model", "llm");

  const rawDeps = parsed["dependencies"];
  const dependencies: KbConfig["dependencies"] = {};
  if (
    rawDeps !== undefined &&
    rawDeps !== null &&
    typeof rawDeps === "object" &&
    !Array.isArray(rawDeps)
  ) {
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
  }

  return {
    project: { name, version },
    directories: { sources, wiki },
    llm: { provider, model },
    dependencies,
  };
}
