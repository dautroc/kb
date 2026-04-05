import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { Project } from "./project.js";
import type { LlmAdapter } from "./llm.js";
import { openDb, closeDb } from "./db.js";
import { searchWiki } from "./search.js";
import { indexProject } from "./indexer.js";

export interface QueryResult {
  answer: string;
  sources: string[];
}

export interface QueryOptions {
  save?: string;
}

const SYSTEM_PROMPT = `You are a knowledgeable assistant answering questions about a project's knowledge base.
Answer concisely using only information from the provided wiki pages.
Use [[page-name]] wikilink syntax to cite specific wiki pages in your answer.
Format your answer in markdown.`;

function assertWithinRoot(absPath: string, root: string): void {
  const resolvedPath = resolve(absPath);
  const resolvedRoot = resolve(root) + "/";
  if (!resolvedPath.startsWith(resolvedRoot)) {
    throw new Error(
      `Unsafe path rejected: "${absPath}" is outside project root`,
    );
  }
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function queryWiki(
  project: Project,
  question: string,
  llm: LlmAdapter,
  options?: QueryOptions,
): Promise<QueryResult> {
  // 1. Auto-index if db doesn't exist
  const dbPath = join(project.kbDir, "index.db");
  if (!existsSync(dbPath)) {
    await indexProject(project);
  }

  // 2. Search for top relevant pages
  const db = openDb(project);
  let searchResults;
  try {
    searchResults = searchWiki(db, question, project.name, { limit: 10 });
  } finally {
    closeDb(db);
  }

  // 3. Read full content of each result page
  const pages: Array<{ path: string; title: string; content: string }> = [];
  for (const result of searchResults) {
    const absPath = join(project.root, result.path);
    const content = await readFileSafe(absPath);
    if (content) {
      pages.push({ path: result.path, title: result.title, content });
    }
  }

  // 4. Build user message
  const pagesSection =
    pages.length > 0
      ? pages
          .map((p) => `### ${p.title} (${p.path})\n${p.content}`)
          .join("\n\n")
      : "(No wiki pages found for this query.)";

  const userMessage = `## Question\n${question}\n\n## Relevant Wiki Pages\n\n${pagesSection}`;

  // 5. Call LLM
  const answer = await llm.complete(
    [{ role: "user", content: userMessage }],
    SYSTEM_PROMPT,
  );

  const sources = pages.map((p) => p.path);

  // 6. If save option provided, write answer as wiki page and append to log
  if (options?.save) {
    const saveRelPath = options.save;
    const saveAbsPath = join(project.root, saveRelPath);
    assertWithinRoot(saveAbsPath, project.root);

    await mkdir(dirname(saveAbsPath), { recursive: true });
    await writeFile(saveAbsPath, answer, "utf8");

    // Append to log.md
    const logPath = join(project.wikiDir, "log.md");
    const timestamp = new Date().toISOString().split("T")[0];
    const logEntry = `\n## ${timestamp} — Queried: ${question}\n\nSaved to: ${saveRelPath}\n`;
    await appendFile(logPath, logEntry, "utf8");

    // Re-index so saved page is searchable
    await indexProject(project);
  }

  return { answer, sources };
}
