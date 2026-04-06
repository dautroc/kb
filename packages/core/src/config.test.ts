import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseGlobalConfig,
  parseProjectConfig,
  mergeConfigs,
  type KbConfig,
} from "./config.js";

describe("parseProjectConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(content: string): Promise<string> {
    const kbDir = join(tmpDir, ".kb");
    await mkdir(kbDir, { recursive: true });
    const configPath = join(kbDir, "config.toml");
    await writeFile(configPath, content, "utf8");
    return configPath;
  }

  const validToml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[dependencies]
`;

  it("parses a valid config.toml", async () => {
    const configPath = await writeConfig(validToml);
    const config = await parseProjectConfig(configPath);

    expect(config.project?.name).toBe("my-project");
    expect(config.project?.version).toBe("0.1.0");
    expect(config.directories?.sources).toBe("sources");
    expect(config.directories?.wiki).toBe("wiki");
    expect(config.llm?.provider).toBe("anthropic");
    expect(config.llm?.model).toBe("claude-sonnet-4-20250514");
    expect(config.dependencies).toEqual({});
  });

  it("parses dependencies when present", async () => {
    const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "openai"
model = "gpt-4"

[dependencies]
shared-glossary = { path = "../shared-glossary" }
`;
    const configPath = await writeConfig(toml);
    const config = await parseProjectConfig(configPath);

    expect(config.llm?.provider).toBe("openai");
    expect(config.dependencies?.["shared-glossary"]).toEqual({
      path: "../shared-glossary",
    });
  });

  it("throws when file not found", async () => {
    const missingPath = join(tmpDir, "nonexistent", "config.toml");
    await expect(parseProjectConfig(missingPath)).rejects.toThrow(
      /not found|no such file/i,
    );
  });

  it("throws on invalid TOML", async () => {
    const configPath = await writeConfig("this is not valid toml ::::");
    await expect(parseProjectConfig(configPath)).rejects.toThrow();
  });

  it("accepts all valid provider enum values", async () => {
    for (const provider of ["anthropic", "openai", "ollama", "zai"]) {
      const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "${provider}"
model = "some-model"
`;
      const configPath = await writeConfig(toml);
      const config = await parseProjectConfig(configPath);
      expect(config.llm?.provider).toBe(provider);
    }
  });
});

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
