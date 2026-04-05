# Global Config Design

**Date:** 2026-04-05  
**Status:** Approved

## Overview

Add a user-level global config at `~/.kb/config.toml` that provides default values for any field in the project config. Project config overrides at the field level — only explicitly set fields win; the global fills in gaps. `kb init` seeds from global defaults and creates the global config if it doesn't exist yet.

---

## Data Types

`KbConfig` (existing) remains the fully-resolved, all-fields-required type.

A new `GlobalConfig` type mirrors it with every field optional:

```ts
type GlobalConfig = {
  project?: { name?: string; version?: string };
  directories?: { sources?: string; wiki?: string };
  llm?: { provider?: KbConfig["llm"]["provider"]; model?: string };
  dependencies?: KbConfig["dependencies"];
};
```

---

## Merge Semantics

1. Start with global config as the base.
2. For each section (`project`, `directories`, `llm`): spread global fields, then overwrite with project fields that are explicitly present.
3. `[dependencies]`: union of global and project keys; project keys win on collision.
4. After merge, validate all required fields are present. On failure, error message names the missing field and states it can be set in either `~/.kb/config.toml` or `.kb/config.toml`.

**Project fields always win over global fields.**

---

## Functions

All changes are in `packages/core/src/config.ts`:

### `parseGlobalConfig(path?: string): Promise<GlobalConfig>`

- Defaults to `~/.kb/config.toml`
- Returns `{}` if file is absent (not an error)
- Throws on malformed TOML
- All fields optional — partial configs are valid

### `parseProjectConfig(configPath: string): Promise<GlobalConfig>`

- Rename of current `parseConfig`
- Validates TOML structure but does NOT require all fields (required-field validation moves to `mergeConfigs`)

### `mergeConfigs(global: GlobalConfig, project: GlobalConfig): KbConfig`

- Pure function — no IO
- Field-level deep merge (project wins)
- Validates that required fields are present in the merged result
- Throws with a message like: `"Missing required field llm.provider — set it in ~/.kb/config.toml or .kb/config.toml"`

### `resolveConfig(projectDir: string): Promise<KbConfig>`

- New main entry point for all call sites
- Calls `parseGlobalConfig()` + `parseProjectConfig(join(projectDir, '.kb/config.toml'))`
- Calls `mergeConfigs` and returns the result
- Replaces all existing uses of `parseConfig`

---

## `kb init` Changes

In `packages/core/src/init.ts`:

1. Call `parseGlobalConfig()` at the start of `initProject`.
2. If `~/.kb/config.toml` does not exist → write it with the hardcoded defaults (same values currently in `buildConfigToml`).
3. Seed the new project's `config.toml` from global config values, falling back to hardcoded defaults for any fields not present in global. `project.name` and `project.version` are always set from the init argument and `"0.1.0"` respectively — global `[project]` fields are ignored during init.

---

## Call Site Updates

All consumers of `parseConfig` are updated to call `resolveConfig(projectDir)` instead. No changes to the MCP server interface, CLI command signatures, or `KbConfig` type consumers.

---

## Testing

### `config.test.ts` additions

- `mergeConfigs`: global-only fields survive; project fields win; missing required fields throw with a useful message; dependencies union correctly
- `parseGlobalConfig`: missing file returns `{}`; malformed TOML throws; partial TOML (only `[llm]`) parses correctly
- `resolveConfig`: global-only (project has no config), project-only (backward compat), both present with overlapping fields

### `init.test.ts` additions

- Global config is created if absent during `kb init`
- New project config is seeded from existing global defaults
