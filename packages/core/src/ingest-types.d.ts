export interface IngestResult {
    summary: {
        path: string;
        content: string;
    };
    updates: Array<{
        path: string;
        content: string;
        reason: string;
    }>;
    newPages: Array<{
        path: string;
        content: string;
        reason: string;
    }>;
    indexUpdate: string;
    logEntry: string;
}
//# sourceMappingURL=ingest-types.d.ts.map