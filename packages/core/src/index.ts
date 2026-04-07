// Core package — business logic

export const VERSION = "0.1.0";

export { initProject } from "./init.js";
export type { InitOptions } from "./init.js";

export {
  parseConfig,
  parseProjectConfig,
  parseGlobalConfig,
  mergeConfigs,
  resolveConfig,
} from "./config.js";
export type { KbConfig, GlobalConfig } from "./config.js";

export { loadProject, tryLoadProject } from "./project.js";
export type { Project, ResolvedDependency } from "./project.js";

export { openDb, closeDb } from "./db.js";

export { parsePage } from "./markdown.js";
export type { ParsedPage, CrossLink } from "./markdown.js";

export { indexProject } from "./indexer.js";
export type { IndexStats, EmbedSummary } from "./indexer.js";

export { searchWiki, searchAcrossProjects } from "./search.js";
export type {
  SearchResult,
  SearchOptions,
  CrossProjectTarget,
} from "./search.js";

export { readSource } from "./source-reader.js";
export type { SourceContent, SourceType } from "./source-reader.js";

export { createLlmAdapter } from "./llm.js";
export type { LlmAdapter, LlmMessage } from "./llm.js";

export type { IngestResult } from "./ingest-types.js";

export { ingestSource } from "./ingest.js";
export type { IngestOptions, IngestPlan } from "./ingest.js";

export { queryWiki } from "./query.js";
export type { QueryResult, QueryOptions } from "./query.js";

export { lintProject } from "./lint.js";
export type { LintIssue, LintResult, LintSeverity } from "./lint.js";

export { parseLogEntries } from "./log-parser.js";
export type { ParsedLogEntry } from "./log-parser.js";

export { embedProject, chunkPage, OllamaUnavailableError } from "./embedder.js";
export type { Chunk, EmbedStats } from "./embedder.js";

export { vectorSearchWiki, mergeRrf } from "./vector-search.js";
export type { VectorSearchResult, SearchConfig } from "./vector-search.js";

export { resolveDependencies, updateGitDep } from "./deps.js";

export {
  findWorkspaceRoot,
  loadWorkspace,
  parseWorkspaceConfig,
} from "./workspace.js";
export type { WorkspaceConfig, Workspace } from "./workspace.js";
