// packages/core/src/llm.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLlmAdapter } from "./llm.js";
import type { KbConfig } from "./config.js";

function makeConfig(
  provider: "anthropic" | "openai" | "ollama",
  model = "test-model",
): KbConfig {
  return {
    project: { name: "test", version: "0.1.0" },
    directories: { sources: "sources", wiki: "wiki" },
    llm: { provider, model },
    dependencies: {},
  };
}

describe("createLlmAdapter", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.restoreAllMocks();
  });

  it("returns an adapter with a complete() method for anthropic", () => {
    const adapter = createLlmAdapter(makeConfig("anthropic"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("returns an adapter with a complete() method for openai", () => {
    const adapter = createLlmAdapter(makeConfig("openai"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("returns an adapter with a complete() method for ollama", () => {
    const adapter = createLlmAdapter(makeConfig("ollama"));
    expect(typeof adapter.complete).toBe("function");
  });

  it("anthropic adapter throws when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const adapter = createLlmAdapter(makeConfig("anthropic"));
    await expect(
      adapter.complete([{ role: "user", content: "hi" }], "system"),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("openai adapter throws when OPENAI_API_KEY is not set", async () => {
    delete process.env["OPENAI_API_KEY"];
    const adapter = createLlmAdapter(makeConfig("openai"));
    await expect(
      adapter.complete([{ role: "user", content: "hi" }], "system"),
    ).rejects.toThrow("OPENAI_API_KEY");
  });

  it("ollama adapter does not require an API key (calls fetch)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "hello from ollama" },
      }),
    }) as unknown as typeof fetch;

    const adapter = createLlmAdapter(makeConfig("ollama"));
    const result = await adapter.complete(
      [{ role: "user", content: "hi" }],
      "system",
    );
    expect(result).toBe("hello from ollama");
  });

  it("throws for unknown provider", () => {
    const config = makeConfig("anthropic");
    (config.llm as { provider: string }).provider = "unknown-provider";
    expect(() => createLlmAdapter(config)).toThrow(
      /unknown.*provider|provider/i,
    );
  });
});
