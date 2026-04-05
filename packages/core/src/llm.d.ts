import type { KbConfig } from "./config.js";
export interface LlmMessage {
    role: "user" | "assistant";
    content: string;
}
export interface LlmAdapter {
    complete(messages: LlmMessage[], systemPrompt: string): Promise<string>;
}
export declare function createLlmAdapter(config: KbConfig): LlmAdapter;
//# sourceMappingURL=llm.d.ts.map