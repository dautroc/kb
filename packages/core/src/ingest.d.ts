import type { Project } from "./project.js";
import type { LlmAdapter } from "./llm.js";
import type { IngestResult } from "./ingest-types.js";
export interface IngestOptions {
    apply?: boolean;
    batch?: boolean;
}
export interface IngestPlan {
    result: IngestResult;
    sourceFile: string;
    dryRun: boolean;
}
export declare function ingestSource(project: Project, sourcePath: string, llm: LlmAdapter, options?: IngestOptions): Promise<IngestPlan>;
//# sourceMappingURL=ingest.d.ts.map