export interface ParsedPage {
    path: string;
    title: string;
    content: string;
    tags: string;
    frontmatter: Record<string, unknown>;
    outgoingLinks: string[];
    wordCount: number;
}
export declare function parsePage(filePath: string, relativePath: string, rawContent?: string): Promise<ParsedPage>;
//# sourceMappingURL=markdown.d.ts.map