function createAnthropicAdapter(model) {
    return {
        async complete(messages, systemPrompt) {
            const apiKey = process.env["ANTHROPIC_API_KEY"];
            if (!apiKey) {
                throw new Error("ANTHROPIC_API_KEY environment variable is not set");
            }
            const Anthropic = await import("@anthropic-ai/sdk").then((m) => m.default ?? m);
            const client = new Anthropic({ apiKey });
            const response = await client.messages.create({
                model,
                max_tokens: 8192,
                system: systemPrompt,
                messages: messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
            });
            const block = response.content[0];
            if (!block || block.type !== "text") {
                throw new Error("Anthropic returned no text content");
            }
            return block.text;
        },
    };
}
function createOpenAiAdapter(model) {
    return {
        async complete(messages, systemPrompt) {
            const apiKey = process.env["OPENAI_API_KEY"];
            if (!apiKey) {
                throw new Error("OPENAI_API_KEY environment variable is not set");
            }
            const body = {
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
            };
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`OpenAI API error: HTTP ${response.status} — ${text}`);
            }
            const data = (await response.json());
            const content = data.choices[0]?.message?.content;
            if (!content) {
                throw new Error("OpenAI returned no content");
            }
            return content;
        },
    };
}
function createOllamaAdapter(model) {
    return {
        async complete(messages, systemPrompt) {
            const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
            const body = {
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
                stream: false,
            };
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Ollama API error: HTTP ${response.status} — ${text}`);
            }
            const data = (await response.json());
            const content = data.message?.content;
            if (!content) {
                throw new Error("Ollama returned no content");
            }
            return content;
        },
    };
}
export function createLlmAdapter(config) {
    const { provider, model } = config.llm;
    switch (provider) {
        case "anthropic":
            return createAnthropicAdapter(model);
        case "openai":
            return createOpenAiAdapter(model);
        case "ollama":
            return createOllamaAdapter(model);
        default: {
            const _exhaustive = provider;
            throw new Error(`Unsupported LLM provider: ${String(_exhaustive)}`);
        }
    }
}
//# sourceMappingURL=llm.js.map