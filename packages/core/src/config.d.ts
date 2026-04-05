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
        provider: "anthropic" | "openai" | "ollama";
        model: string;
    };
    dependencies: Record<string, {
        path?: string;
        git?: string;
        branch?: string;
        mode?: string;
    }>;
}
export declare function parseConfig(configPath: string): Promise<KbConfig>;
//# sourceMappingURL=config.d.ts.map