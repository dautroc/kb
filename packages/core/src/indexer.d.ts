import type { Project } from "./project.js";
export interface IndexStats {
    indexed: number;
    skipped: number;
    deleted: number;
    errors: number;
}
export declare function indexProject(project: Project, rebuild?: boolean): Promise<IndexStats>;
//# sourceMappingURL=indexer.d.ts.map