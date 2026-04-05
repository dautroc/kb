// Core package — business logic
export const VERSION = "0.1.0";
export { initProject } from "./init.js";
export { parseConfig } from "./config.js";
export { loadProject, tryLoadProject } from "./project.js";
export { openDb, closeDb } from "./db.js";
export { parsePage } from "./markdown.js";
export { indexProject } from "./indexer.js";
export { searchWiki } from "./search.js";
export { readSource } from "./source-reader.js";
export { createLlmAdapter } from "./llm.js";
export { ingestSource } from "./ingest.js";
//# sourceMappingURL=index.js.map