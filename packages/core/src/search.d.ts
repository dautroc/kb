import Database from "better-sqlite3";
export interface SearchResult {
    rank: number;
    path: string;
    title: string;
    snippet: string;
    tags: string[];
}
export interface SearchOptions {
    limit?: number;
    tags?: string[];
}
export declare function searchWiki(db: Database.Database, query: string, projectName: string, options?: SearchOptions): SearchResult[];
//# sourceMappingURL=search.d.ts.map