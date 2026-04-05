import { readFile } from "node:fs/promises";
import TOML from "@iarna/toml";
const VALID_PROVIDERS = ["anthropic", "openai", "ollama"];
function requireSafeRelativePath(val, field) {
    if (val.startsWith("/") || val.split("/").includes("..")) {
        throw new Error(`Invalid config: ${field} must be a safe relative path, got "${val}"`);
    }
}
function requireString(obj, key, context) {
    const val = obj[key];
    if (typeof val !== "string" || val.trim() === "") {
        throw new Error(`Invalid config: missing required field "${context}.${key}"`);
    }
    return val;
}
function requireSection(obj, key) {
    const val = obj[key];
    if (val === undefined ||
        val === null ||
        typeof val !== "object" ||
        Array.isArray(val)) {
        throw new Error(`Invalid config: missing required section "[${key}]"`);
    }
    return val;
}
export async function parseConfig(configPath) {
    let raw;
    try {
        raw = await readFile(configPath, "utf8");
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Config file not found: ${configPath}\n${message}`);
    }
    let parsed;
    try {
        parsed = TOML.parse(raw);
    }
    catch (err) {
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
    if (!VALID_PROVIDERS.includes(providerRaw)) {
        throw new Error(`Invalid config: llm.provider must be one of ${VALID_PROVIDERS.join(", ")}, got "${providerRaw}"`);
    }
    const provider = providerRaw;
    const model = requireString(llm, "model", "llm");
    const rawDeps = parsed["dependencies"];
    const dependencies = {};
    if (rawDeps !== undefined &&
        rawDeps !== null &&
        typeof rawDeps === "object" &&
        !Array.isArray(rawDeps)) {
        for (const [depKey, depVal] of Object.entries(rawDeps)) {
            if (typeof depVal === "object" &&
                depVal !== null &&
                !Array.isArray(depVal)) {
                const dep = depVal;
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
//# sourceMappingURL=config.js.map