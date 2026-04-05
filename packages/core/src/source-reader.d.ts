export type SourceType = "markdown" | "text" | "pdf" | "url";
export interface SourceContent {
    type: SourceType;
    originalPath: string;
    content: string;
    filename: string;
}
export declare function readSource(sourcePath: string): Promise<SourceContent>;
//# sourceMappingURL=source-reader.d.ts.map