# Global Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-level `~/.kb/config.toml` that provides field-level defaults for all kb projects, seeded on `kb init`.

**Architecture:** Introduce `GlobalConfig` (all fields optional), `parseGlobalConfig`, `parseProjectConfig` (renamed from `parseConfig`, now returns partial), `mergeConfigs` (pure, validates required fields after merge), and `resolveConfig` (new public entry point). `project.ts` switches to `resolveConfig`. `init.ts` creates `~/.kb/config.toml` if absent and seeds new project configs from it.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `@iarna/toml`, Vitest

---

## File Map

| File                               | Change                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/config.ts`      | Add `GlobalConfig` type, `parseGlobalConfig`, rename `parseConfig`→`parseProjectConfig` (returns `GlobalConfig`), add `mergeConfigs`, add `resolveConfig`                  |
| `packages/core/src/config.test.ts` | Add `parseGlobalConfig` tests, add `mergeConfigs` tests (absorb moved validation tests), add `resolveConfig` tests, update `parseConfig` → `parseProjectConfig` references |
| `packages/core/src/project.ts`     | Replace `parseConfig(configPath)` with `resolveConfig(root)`                                                                                                               |
| `packages/core/src/index.ts`       | Replace `parseConfig` export with `resolveConfig`, `parseGlobalConfig`, `parseProjectConfig`, `mergeConfigs`; add `GlobalConfig` type export                               |
| `packages/core/src/init.ts`        | Add `globalConfigPath?: string` to `InitOptions`; create `~/.kb/config.toml` if absent; seed project config from global                                                    |
| `packages/core/src/init.test.ts`   | Add tests for global config creation and project seeding                                                                                                                   |

---

## Task 1: Add `GlobalConfig` type and `parseGlobalConfig`

**Files:**

- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`

- [ ] **Step 1: Write failing tests for `parseGlobalConfig`**

Add this new `describe` block at the bottom of `packages/core/src/config.test.ts`, after the closing `});` of the existing `describe("parseConfig", ...)`:

```ts
import { parseConfig, parseGlobalConfig } from "./config.js";
```

Replace the existing import line with the above, then add at the bottom of the file:

```ts
describe("parseGlobalConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-global-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns {} when file does not exist", async () => {
    const result = await parseGlobalConfig(
      join(tmpDir, "nonexistent", "config.toml"),
    );
    expect(result).toEqual({});
  });

  it("throws on malformed TOML", async () => {
    const p = join(tmpDir, "config.toml");
    await writeFile(p, "this is not valid toml ::::", "utf8");
    await expect(parseGlobalConfig(p)).rejects.toThrow(/invalid toml/i);
  });

  it("parses a partial config with only [llm]", async () => {
    const p = join(tmpDir, "config.toml");
    await writeFile(
      p,
      `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
      "utf8",
    );
    const result = await parseGlobalConfig(p);
    expect(result.llm?.provider).toBe("openai");
    expect(result.llm?.model).toBe("gpt-4o");
    expect(result.project).toBeUndefined();
    expect(result.directories).toBeUndefined();
  });

  it("parses a full global config", async () => {
    const p = join(tmpDir, "config.toml");
    await writeFile(
      p,
      `[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n\n[directories]\nsources = "src"\nwiki = "docs"\n`,
      "utf8",
    );
    const result = await parseGlobalConfig(p);
    expect(result.llm?.provider).toBe("anthropic");
    expect(result.directories?.sources).toBe("src");
    expect(result.directories?.wiki).toBe("docs");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- config 2>&1 | tail -20
```

Expected: FAIL — `parseGlobalConfig` is not exported.

- [ ] **Step 3: Add `GlobalConfig` type and `parseGlobalConfig` to `config.ts`**

Add the following after the closing `}` of the `KbConfig` interface (after line 21) and before `const VALID_PROVIDERS`:

```ts
export type GlobalConfig = {
  project?: { name?: string; version?: string };
  directories?: { sources?: string; wiki?: string };
  llm?: { provider?: KbConfig["llm"]["provider"]; model?: string };
  dependencies?: KbConfig["dependencies"];
};
```

Then add the following new function after the `requireSection` function (before `parseConfig`):

```ts
export async function parseGlobalConfig(path?: string): Promise<GlobalConfig> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- config 2>&1 | tail -20
```

Expected: all `parseGlobalConfig` tests PASS; existing `parseConfig` tests still PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/config.ts packages/core/src/config.test.ts && git commit -m "feat(core): add GlobalConfig type and parseGlobalConfig"
```

---

## Task 2: Rename `parseConfig` → `parseProjectConfig`, loosen validation, add `mergeConfigs`

**Files:**

- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`

- [ ] **Step 1: Write failing tests for `mergeConfigs` and updated `parseProjectConfig`**

Replace the import at the top of `packages/core/src/config.test.ts`:

```ts
import {
  parseConfig,
  parseGlobalConfig,
  parseProjectConfig,
  mergeConfigs,
} from "./config.js";
```

Then rename the existing `describe("parseConfig", ...)` block header to `describe("parseProjectConfig", ...)` and update all `parseConfig(` calls inside it to `parseProjectConfig(`.

Remove these test cases from the `parseProjectConfig` describe block (they test required-field validation which moves to `mergeConfigs`):

- `"throws when project.name is missing"`
- `"throws when project.version is missing"`
- `"throws when directories.sources is missing"`
- `"throws when llm.provider is an invalid value"`
- `"throws when directories.sources is an absolute path"`
- `"throws when directories.wiki contains .. traversal"`

Also update the `"parses a valid config.toml"` test to match the new return type (still works since `KbConfig` fields are all present in the valid TOML — just verify the assertion still holds).

Then add a new `describe("mergeConfigs", ...)` block after the `parseGlobalConfig` describe:

```ts
describe("mergeConfigs", () => {
  it("global-only fields survive when project has none", () => {
    const global = {
      project: { name: "global-proj", version: "1.0.0" },
      directories: { sources: "src", wiki: "docs" },
      llm: { provider: "openai" as const, model: "gpt-4o" },
      dependencies: {},
    };
    const result = mergeConfigs(global, {});
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.model).toBe("gpt-4o");
    expect(result.directories.sources).toBe("src");
  });

  it("project fields win over global fields", () => {
    const global = {
      llm: { provider: "openai" as const, model: "gpt-4o" },
    };
    const project = {
      project: { name: "my-proj", version: "0.1.0" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
      dependencies: {},
    };
    const result = mergeConfigs(global, project);
    expect(result.llm.provider).toBe("anthropic");
    expect(result.llm.model).toBe("claude-sonnet-4-20250514");
  });

  it("project partially overrides global llm — only set fields win", () => {
    const global = {
      project: { name: "g", version: "0.1.0" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: { provider: "openai" as const, model: "gpt-4o" },
      dependencies: {},
    };
    const project = {
      llm: { model: "gpt-4-turbo" },
    };
    const result = mergeConfigs(global, project);
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.model).toBe("gpt-4-turbo");
  });

  it("dependencies are unioned — project keys win on collision", () => {
    const global = {
      project: { name: "p", version: "0.1.0" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
      dependencies: {
        "shared-glossary": { path: "../shared-glossary" },
        "shared-lib": { path: "../shared-lib" },
      },
    };
    const project = {
      dependencies: {
        "shared-glossary": { path: "../project-glossary" },
      },
    };
    const result = mergeConfigs(global, project);
    expect(result.dependencies["shared-glossary"]).toEqual({
      path: "../project-glossary",
    });
    expect(result.dependencies["shared-lib"]).toEqual({
      path: "../shared-lib",
    });
  });

  it("throws when project.name is missing from both", () => {
    const project = {
      project: { version: "0.1.0" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(() => mergeConfigs({}, project)).toThrow(/project\.name/i);
  });

  it("throws when project.version is missing from both", () => {
    const project = {
      project: { name: "p" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(() => mergeConfigs({}, project)).toThrow(/project\.version/i);
  });

  it("throws when directories.sources is missing from both", () => {
    const project = {
      project: { name: "p", version: "0.1.0" },
      directories: { wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(() => mergeConfigs({}, project)).toThrow(/directories\.sources/i);
  });

  it("throws when llm.provider is invalid", () => {
    const project = {
      project: { name: "p", version: "0.1.0" },
      directories: { sources: "sources", wiki: "wiki" },
      llm: { provider: "grok" as KbConfig["llm"]["provider"], model: "grok-1" },
    };
    expect(() => mergeConfigs({}, project)).toThrow(/provider/i);
  });

  it("throws when directories.sources is an absolute path", () => {
    const project = {
      project: { name: "p", version: "0.1.0" },
      directories: { sources: "/etc/passwd", wiki: "wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(() => mergeConfigs({}, project)).toThrow(
      /directories\.sources must be a safe relative path/i,
    );
  });

  it("throws when directories.wiki contains .. traversal", () => {
    const project = {
      project: { name: "p", version: "0.1.0" },
      directories: { sources: "sources", wiki: "../../wiki" },
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(() => mergeConfigs({}, project)).toThrow(
      /directories\.wiki must be a safe relative path/i,
    );
  });

  it("throws with helpful message mentioning both config locations", () => {
    expect(() => mergeConfigs({}, {})).toThrow(
      /~\/.kb\/config\.toml.*\.kb\/config\.toml|\.kb\/config\.toml.*~\/.kb\/config\.toml/i,
    );
  });
});
```

Also add `KbConfig` to the import:

```ts
import {
  parseConfig,
  parseGlobalConfig,
  parseProjectConfig,
  mergeConfigs,
  type KbConfig,
} from "./config.js";
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- config 2>&1 | tail -30
```

Expected: FAIL — `parseProjectConfig` and `mergeConfigs` not exported yet.

- [ ] **Step 3: Rename `parseConfig` → `parseProjectConfig` in `config.ts`, loosen it to return `GlobalConfig`**

In `packages/core/src/config.ts`, replace the entire `parseConfig` function:

```ts
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

/** @deprecated Use resolveConfig(projectDir) instead */
export async function parseConfig(configPath: string): Promise<KbConfig> {
  const project = await parseProjectConfig(configPath);
  return mergeConfigs({}, project);
}
```

Note: `mergeConfigs` is referenced here but defined next — it will be added in the same step.

- [ ] **Step 4: Add `mergeConfigs` to `config.ts`**

Add the following function after `parseProjectConfig` and before `parseConfig`:

```ts
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
```

You can now also remove the `requireSafeRelativePath`, `requireString`, and `requireSection` helper functions from `config.ts` since `mergeConfigs` handles all validation inline. (Verify they are not used anywhere else first with: `grep -n "requireSafeRelativePath\|requireString\|requireSection" packages/core/src/config.ts`.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- config 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/config.ts packages/core/src/config.test.ts && git commit -m "feat(core): add mergeConfigs, rename parseConfig→parseProjectConfig"
```

---

## Task 3: Add `resolveConfig`, update `project.ts` and `index.ts`

**Files:**

- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for `resolveConfig`**

Update the import in `config.test.ts` to add `resolveConfig`:

```ts
import {
  parseConfig,
  parseGlobalConfig,
  parseProjectConfig,
  mergeConfigs,
  resolveConfig,
  type KbConfig,
} from "./config.js";
```

Add the following `describe` block after `describe("mergeConfigs", ...)`:

```ts
describe("resolveConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-resolve-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeProjectConfig(content: string): Promise<void> {
    const kbDir = join(tmpDir, ".kb");
    await mkdir(kbDir, { recursive: true });
    await writeFile(join(kbDir, "config.toml"), content, "utf8");
  }

  async function writeGlobalConfig(
    dir: string,
    content: string,
  ): Promise<string> {
    await mkdir(dir, { recursive: true });
    const p = join(dir, "config.toml");
    await writeFile(p, content, "utf8");
    return p;
  }

  it("resolves from project config alone (backward compat)", async () => {
    await writeProjectConfig(`
[project]
name = "my-proj"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`);
    const globalDir = join(tmpDir, "global");
    const globalPath = join(globalDir, "config.toml");
    const result = await resolveConfig(tmpDir, globalPath);
    expect(result.project.name).toBe("my-proj");
    expect(result.llm.provider).toBe("anthropic");
  });

  it("global-only: resolves when project config has no [llm]", async () => {
    await writeProjectConfig(`
[project]
name = "my-proj"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"
`);
    const globalDir = join(tmpDir, "global");
    await writeGlobalConfig(
      globalDir,
      `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
    );
    const result = await resolveConfig(tmpDir, join(globalDir, "config.toml"));
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.model).toBe("gpt-4o");
  });

  it("project wins over global when both set the same field", async () => {
    await writeProjectConfig(`
[project]
name = "my-proj"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`);
    const globalDir = join(tmpDir, "global");
    await writeGlobalConfig(
      globalDir,
      `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
    );
    const result = await resolveConfig(tmpDir, join(globalDir, "config.toml"));
    expect(result.llm.provider).toBe("anthropic");
    expect(result.llm.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws when neither global nor project provides required fields", async () => {
    await writeProjectConfig(`
[project]
name = "my-proj"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"
`);
    const globalPath = join(tmpDir, "global", "config.toml");
    await expect(resolveConfig(tmpDir, globalPath)).rejects.toThrow(
      /llm\.provider/i,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- config 2>&1 | tail -20
```

Expected: FAIL — `resolveConfig` not exported yet.

- [ ] **Step 3: Add `resolveConfig` to `config.ts`**

Add the following import at the top of `config.ts` (alongside the existing `import { readFile } from "node:fs/promises"`):

Add `homedir` and `join` imports. The top of `config.ts` should now read:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";
```

Then add the `resolveConfig` function after `parseConfig` (at the end of the file):

```ts
export async function resolveConfig(
  projectDir: string,
  globalConfigPath?: string,
): Promise<KbConfig> {
  const resolvedGlobalPath =
    globalConfigPath ?? join(homedir(), ".kb", "config.toml");

  const [globalCfg, projectCfg] = await Promise.all([
    parseGlobalConfig(resolvedGlobalPath),
    parseProjectConfig(join(projectDir, ".kb", "config.toml")),
  ]);

  return mergeConfigs(globalCfg, projectCfg);
}
```

Also remove the dynamic imports inside `parseGlobalConfig` now that `join` and `homedir` are top-level imports. Find these lines inside `parseGlobalConfig`:

```ts
const { homedir } = await import("node:os");
const { join } = await import("node:path");
```

And replace with nothing (they are now top-level). Update the resolved path line to:

```ts
const resolvedPath = path ?? join(homedir(), ".kb", "config.toml");
```

(This line already exists — just remove the two dynamic import lines above it.)

- [ ] **Step 4: Update `project.ts` to use `resolveConfig`**

Replace the contents of `packages/core/src/project.ts`:

```ts
import { access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { resolveConfig, type KbConfig } from "./config.js";

export interface Project {
  name: string;
  root: string;
  kbDir: string;
  sourcesDir: string;
  wikiDir: string;
  config: KbConfig;
}

async function hasKbDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".kb", "config.toml"));
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir);

  while (true) {
    if (await hasKbDir(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function loadProject(startDir: string): Promise<Project> {
  const root = await findProjectRoot(startDir);
  if (root === null) {
    throw new Error(
      `No kb project found. Run "kb init" to initialize a knowledge base in the current directory.`,
    );
  }

  const kbDir = join(root, ".kb");
  const config = await resolveConfig(root);

  return {
    name: config.project.name,
    root,
    kbDir,
    sourcesDir: join(root, config.directories.sources),
    wikiDir: join(root, config.directories.wiki),
    config,
  };
}

export async function tryLoadProject(
  startDir: string,
): Promise<Project | null> {
  try {
    return await loadProject(startDir);
  } catch (err: unknown) {
    if (err instanceof Error && /no kb project found/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Update `index.ts` exports**

Replace the config-related exports in `packages/core/src/index.ts`:

```ts
export {
  parseConfig,
  parseProjectConfig,
  parseGlobalConfig,
  mergeConfigs,
  resolveConfig,
} from "./config.js";
export type { KbConfig, GlobalConfig } from "./config.js";
```

(Replace the two existing lines: `export { parseConfig } from "./config.js";` and `export type { KbConfig } from "./config.js";`)

- [ ] **Step 6: Run all tests**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/config.ts packages/core/src/config.test.ts packages/core/src/project.ts packages/core/src/index.ts && git commit -m "feat(core): add resolveConfig, update project.ts and index.ts exports"
```

---

## Task 4: Update `init.ts` to create global config and seed from it

**Files:**

- Modify: `packages/core/src/init.ts`
- Modify: `packages/core/src/init.test.ts`

- [ ] **Step 1: Write failing tests for new init behavior**

Add to `packages/core/src/init.test.ts`:

Update the existing import at the top:

```ts
import {
  mkdtemp,
  rm,
  readFile,
  access,
  writeFile,
  mkdir,
} from "node:fs/promises";
```

Add a `globalConfigDir` variable to the test suite. Add this inside `describe("initProject", ...)`, after `let tmpDir: string;`:

```ts
let globalConfigDir: string;
```

Update `beforeEach` to also create a temp global dir:

```ts
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kb-test-"));
  globalConfigDir = await mkdtemp(join(tmpdir(), "kb-global-test-"));
});
```

Update `afterEach` to clean up both:

```ts
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await rm(globalConfigDir, { recursive: true, force: true });
});
```

Update all existing `initProject({ name: "...", directory: tmpDir })` calls to pass the global config path:

```ts
await initProject({
  name: "my-project",
  directory: tmpDir,
  globalConfigPath: join(globalConfigDir, "config.toml"),
});
```

(Do this for every `initProject` call in the existing tests.)

Then add these new tests at the bottom of the describe block:

```ts
it("creates global config with defaults when it does not exist", async () => {
  const globalConfigPath = join(globalConfigDir, "config.toml");
  await initProject({
    name: "my-project",
    directory: tmpDir,
    globalConfigPath,
  });

  expect(await fileExists(globalConfigPath)).toBe(true);
  const content = await readFile(globalConfigPath, "utf8");
  expect(content).toContain('provider = "anthropic"');
  expect(content).toContain("claude-sonnet-4-20250514");
});

it("does not overwrite existing global config", async () => {
  const globalConfigPath = join(globalConfigDir, "config.toml");
  await writeFile(
    globalConfigPath,
    `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n`,
    "utf8",
  );

  await initProject({
    name: "my-project",
    directory: tmpDir,
    globalConfigPath,
  });

  const content = await readFile(globalConfigPath, "utf8");
  expect(content).toContain('provider = "openai"');
});

it("seeds project config from existing global config", async () => {
  const globalConfigPath = join(globalConfigDir, "config.toml");
  await writeFile(
    globalConfigPath,
    `[llm]\nprovider = "openai"\nmodel = "gpt-4o"\n\n[directories]\nsources = "sources"\nwiki = "wiki"\n`,
    "utf8",
  );

  await initProject({
    name: "my-project",
    directory: tmpDir,
    globalConfigPath,
  });

  const configPath = join(tmpDir, ".kb", "config.toml");
  const content = await readFile(configPath, "utf8");
  expect(content).toContain('provider = "openai"');
  expect(content).toContain('model = "gpt-4o"');
});

it("project name in config is always from init arg, not global", async () => {
  const globalConfigPath = join(globalConfigDir, "config.toml");
  await writeFile(
    globalConfigPath,
    `[project]\nname = "global-name"\nversion = "9.9.9"\n\n[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\n`,
    "utf8",
  );

  await initProject({
    name: "my-project",
    directory: tmpDir,
    globalConfigPath,
  });

  const configPath = join(tmpDir, ".kb", "config.toml");
  const content = await readFile(configPath, "utf8");
  expect(content).toContain('name = "my-project"');
  expect(content).toContain('version = "0.1.0"');
  expect(content).not.toContain("global-name");
  expect(content).not.toContain("9.9.9");
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- init 2>&1 | tail -20
```

Expected: FAIL — `globalConfigPath` not in `InitOptions` yet.

- [ ] **Step 3: Update `init.ts`**

Replace the full contents of `packages/core/src/init.ts`:

```ts
import { mkdir, writeFile, access, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";
import { parseGlobalConfig, type GlobalConfig } from "./config.js";

export interface InitOptions {
  name: string;
  directory: string;
  globalConfigPath?: string;
}

function resolveProjectName(options: InitOptions): string {
  return options.name || basename(options.directory);
}

const HARDCODED_DEFAULTS = {
  llm: { provider: "anthropic" as const, model: "claude-sonnet-4-20250514" },
  directories: { sources: "sources", wiki: "wiki" },
};

function buildGlobalConfigToml(): string {
  return TOML.stringify({
    llm: {
      provider: HARDCODED_DEFAULTS.llm.provider,
      model: HARDCODED_DEFAULTS.llm.model,
    },
    directories: {
      sources: HARDCODED_DEFAULTS.directories.sources,
      wiki: HARDCODED_DEFAULTS.directories.wiki,
    },
  } as TOML.JsonMap);
}

function buildConfigToml(projectName: string, seed: GlobalConfig): string {
  const config = {
    project: {
      name: projectName,
      version: "0.1.0",
    },
    directories: {
      sources:
        seed.directories?.sources ?? HARDCODED_DEFAULTS.directories.sources,
      wiki: seed.directories?.wiki ?? HARDCODED_DEFAULTS.directories.wiki,
    },
    llm: {
      provider: seed.llm?.provider ?? HARDCODED_DEFAULTS.llm.provider,
      model: seed.llm?.model ?? HARDCODED_DEFAULTS.llm.model,
    },
  };

  const tomlStr = TOML.stringify(config as TOML.JsonMap);
  return (
    tomlStr +
    '\n[dependencies]\n# shared-glossary = { path = "../shared-glossary" }\n'
  );
}

async function globalConfigExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function buildSchemaMd(): string {
  return `# KB Schema — LLM Instructions

This file defines the conventions for this knowledge base. The \`kb\` CLI and any
LLM operating on this wiki MUST follow these rules.

---

## Wiki Structure Conventions

- All pages live under the \`wiki/\` directory.
- \`wiki/_index.md\` is the wiki root and serves as a table of contents.
- Sub-topics may be organised into sub-directories: \`wiki/<topic>/_index.md\`.
- File names use kebab-case, e.g. \`wiki/authentication-flow.md\`.
- Every page must have a valid YAML frontmatter block.

---

## Frontmatter Schema

Every wiki page must begin with a YAML frontmatter block:

\`\`\`yaml
---
title: <Human-readable page title>
tags: [tag1, tag2]        # optional; array of lowercase strings
created: <ISO 8601 date>  # e.g. 2026-04-05
updated: <ISO 8601 date>  # updated whenever content changes
source: <path or URL>     # optional; original source material
---
\`\`\`

Required fields: \`title\`, \`created\`.

---

## Page Templates

### Entity Page
Use for: people, systems, services, tools.

\`\`\`markdown
---
title: <Entity Name>
tags: [entity]
created: <ISO date>
updated: <ISO date>
---

# <Entity Name>

**Type**: <system | person | service | tool>

## Overview

<One-paragraph description.>

## Key Attributes

- **Attribute**: value

## Related

- [[related-page]]
\`\`\`

### Concept Page
Use for: ideas, patterns, terminology.

\`\`\`markdown
---
title: <Concept Name>
tags: [concept]
created: <ISO date>
updated: <ISO date>
---

# <Concept Name>

## Definition

<Clear definition in 1-3 sentences.>

## Context

<When and why this concept matters in the project.>

## See Also

- [[related-concept]]
\`\`\`

### Source Summary Page
Use for: summarised source material (docs, papers, meetings).

\`\`\`markdown
---
title: Summary — <Source Title>
tags: [source-summary]
created: <ISO date>
source: <path or URL>
---

# Summary — <Source Title>

## Key Points

- Point one
- Point two

## Decisions / Implications

<What this source means for the project.>

## Raw Source

See \`sources/<filename>\`.
\`\`\`

### Comparison Page
Use for: side-by-side evaluation of options.

\`\`\`markdown
---
title: Comparison — <Topic>
tags: [comparison]
created: <ISO date>
updated: <ISO date>
---

# Comparison — <Topic>

| Criterion | Option A | Option B |
|-----------|----------|----------|
| ...       | ...      | ...      |

## Recommendation

<Which option and why.>
\`\`\`

---

## Wikilink Conventions

- Basic link: \`[[page-name]]\` — links to \`wiki/page-name.md\`.
- Display text: \`[[page-name|display text]]\` — renders as "display text".
- Cross-directory: \`[[topic/sub-page]]\`.
- All wikilink targets must be lowercase kebab-case matching the file name without \`.md\`.

---

## Ingest Workflow

1. Place the source file in \`sources/\` (PDF, Markdown, plain text, etc.).
2. Run \`kb ingest sources/<filename>\`.
3. The CLI reads the file, calls the configured LLM, and generates a source-summary
   page in \`wiki/\`.
4. The summary page is linked from \`wiki/_index.md\` under **Sources**.
5. An entry is appended to \`log.md\`.

---

## Query Workflow

1. Run \`kb query "<natural-language question>"\`.
2. The CLI searches the wiki index for relevant pages.
3. Relevant page content is assembled into a prompt context.
4. The LLM answers the question, citing wikilinks.
5. The answer is printed to stdout. Nothing is written to disk unless \`--save\` is passed.

---

## Lint Workflow

Run \`kb lint\` to check for:

- Pages missing required frontmatter fields (\`title\`, \`created\`).
- Broken wikilinks (targets that don't resolve to an existing page).
- Pages not reachable from \`wiki/_index.md\`.
- Duplicate page titles across the wiki.
- Frontmatter fields with invalid types or formats.

Lint exits with code 0 on success, 1 if errors are found.
`;
}

function buildIndexMd(projectName: string, isoDate: string): string {
  return `---
title: ${projectName} Knowledge Base
created: ${isoDate}
---

# ${projectName} Knowledge Base

> This wiki is maintained by the \`kb\` CLI tool.

## Pages

(No pages yet. Use \`kb ingest <source>\` to add content.)

## Sources

(No sources yet.)
`;
}

function buildLogMd(projectName: string, isoDate: string): string {
  return `# Activity Log

## ${isoDate} — Project initialized

Project \`${projectName}\` initialized.
`;
}

async function kbDirExists(directory: string): Promise<boolean> {
  try {
    await access(join(directory, ".kb"));
    return true;
  } catch {
    return false;
  }
}

export async function initProject(options: InitOptions): Promise<void> {
  const projectName = resolveProjectName(options);
  const { directory } = options;
  const globalConfigPath =
    options.globalConfigPath ?? join(homedir(), ".kb", "config.toml");

  if (await kbDirExists(directory)) {
    throw new Error(
      `Knowledge base already initialized: .kb/ already exists in ${directory}`,
    );
  }

  // Ensure global config exists; create with defaults if not
  if (!(await globalConfigExists(globalConfigPath))) {
    await mkdir(join(globalConfigPath, ".."), { recursive: true });
    await writeFile(globalConfigPath, buildGlobalConfigToml(), "utf8");
  }

  // Seed project config from global defaults
  const globalCfg = await parseGlobalConfig(globalConfigPath);

  const isoDate = new Date().toISOString().split("T")[0]!;

  try {
    await Promise.all([
      mkdir(join(directory, ".kb"), { recursive: true }),
      mkdir(join(directory, "sources"), { recursive: true }),
      mkdir(join(directory, "wiki"), { recursive: true }),
    ]);

    await Promise.all([
      writeFile(
        join(directory, ".kb", "config.toml"),
        buildConfigToml(projectName, globalCfg),
        "utf8",
      ),
      writeFile(join(directory, ".kb", "schema.md"), buildSchemaMd(), "utf8"),
      writeFile(join(directory, "sources", ".gitkeep"), "", "utf8"),
      writeFile(
        join(directory, "wiki", "_index.md"),
        buildIndexMd(projectName, isoDate),
        "utf8",
      ),
      writeFile(
        join(directory, "log.md"),
        buildLogMd(projectName, isoDate),
        "utf8",
      ),
    ]);
  } catch (error) {
    await rm(join(directory, ".kb"), { recursive: true, force: true });
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/loi/workspace/kb && pnpm test --filter kb-core -- init 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/loi/workspace/kb && pnpm test 2>&1 | tail -30
```

Expected: all tests PASS across all packages.

- [ ] **Step 6: Build to verify TypeScript compiles**

```bash
cd /Users/loi/workspace/kb && pnpm build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/loi/workspace/kb && git add packages/core/src/init.ts packages/core/src/init.test.ts && git commit -m "feat(core): update init to create and seed from global config"
```
