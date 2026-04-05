import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
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
    const config = await parseConfig(configPath);

    expect(config.project.name).toBe("my-project");
    expect(config.project.version).toBe("0.1.0");
    expect(config.directories.sources).toBe("sources");
    expect(config.directories.wiki).toBe("wiki");
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-sonnet-4-20250514");
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
    const config = await parseConfig(configPath);

    expect(config.llm.provider).toBe("openai");
    expect(config.dependencies["shared-glossary"]).toEqual({
      path: "../shared-glossary",
    });
  });

  it("throws when file not found", async () => {
    const missingPath = join(tmpDir, "nonexistent", "config.toml");
    await expect(parseConfig(missingPath)).rejects.toThrow(
      /not found|no such file/i,
    );
  });

  it("throws on invalid TOML", async () => {
    const configPath = await writeConfig("this is not valid toml ::::");
    await expect(parseConfig(configPath)).rejects.toThrow();
  });

  it("throws when project.name is missing", async () => {
    const toml = `
[project]
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(/project\.name/i);
  });

  it("throws when project.version is missing", async () => {
    const toml = `
[project]
name = "my-project"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(/project\.version/i);
  });

  it("throws when directories.sources is missing", async () => {
    const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(
      /directories\.sources/i,
    );
  });

  it("throws when llm.provider is an invalid value", async () => {
    const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "wiki"

[llm]
provider = "grok"
model = "grok-1"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(/provider/i);
  });

  it("throws when directories.sources is an absolute path", async () => {
    const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "/etc/passwd"
wiki = "wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(
      /directories\.sources must be a safe relative path/i,
    );
  });

  it("throws when directories.wiki contains .. traversal", async () => {
    const toml = `
[project]
name = "my-project"
version = "0.1.0"

[directories]
sources = "sources"
wiki = "../../wiki"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
`;
    const configPath = await writeConfig(toml);
    await expect(parseConfig(configPath)).rejects.toThrow(
      /directories\.wiki must be a safe relative path/i,
    );
  });

  it("accepts all valid provider enum values", async () => {
    for (const provider of ["anthropic", "openai", "ollama"]) {
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
      const config = await parseConfig(configPath);
      expect(config.llm.provider).toBe(provider);
    }
  });
});
