import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { Project } from "./project.js";
import type { LlmAdapter } from "./llm.js";
import type { IngestResult } from "./ingest-types.js";
import { readSource } from "./source-reader.js";
import { indexProject } from "./indexer.js";

export interface IngestOptions {
  apply?: boolean;
  batch?: boolean;
}

export interface IngestPlan {
  result: IngestResult;
  sourceFile: string;
  dryRun: boolean;
}

const SYSTEM_PROMPT = `You are an AI assistant maintaining a knowledge base wiki.
You will be given a new source document and the current state of the wiki.
Your task is to integrate the new knowledge into the wiki.

Return ONLY a JSON object matching this exact schema (no markdown fences):
{
  "summary": { "path": "wiki/sources/<filename>-summary.md", "content": "..." },
  "updates": [{ "path": "...", "content": "...", "reason": "..." }],
  "newPages": [{ "path": "...", "content": "...", "reason": "..." }],
  "indexUpdate": "...",
  "logEntry": "..."
}`;

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

function parseIngestResult(raw: string): IngestResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Invalid LLM response: could not parse JSON. Raw response: ${cleaned.slice(0, 200)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid LLM response: expected a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (
    !obj["summary"] ||
    typeof obj["summary"] !== "object" ||
    Array.isArray(obj["summary"])
  ) {
    throw new Error('Invalid LLM response: missing "summary" object');
  }

  const summary = obj["summary"] as Record<string, unknown>;
  if (
    typeof summary["path"] !== "string" ||
    typeof summary["content"] !== "string"
  ) {
    throw new Error(
      'Invalid LLM response: "summary" must have "path" and "content" strings',
    );
  }

  if (!Array.isArray(obj["updates"])) {
    throw new Error('Invalid LLM response: "updates" must be an array');
  }

  if (!Array.isArray(obj["newPages"])) {
    throw new Error('Invalid LLM response: "newPages" must be an array');
  }

  if (typeof obj["indexUpdate"] !== "string") {
    throw new Error('Invalid LLM response: "indexUpdate" must be a string');
  }

  if (typeof obj["logEntry"] !== "string") {
    throw new Error('Invalid LLM response: "logEntry" must be a string');
  }

  const updates = (obj["updates"] as unknown[]).map((u, i) => {
    if (typeof u !== "object" || u === null || Array.isArray(u)) {
      throw new Error(`Invalid LLM response: updates[${i}] must be an object`);
    }
    const update = u as Record<string, unknown>;
    if (
      typeof update["path"] !== "string" ||
      typeof update["content"] !== "string" ||
      typeof update["reason"] !== "string"
    ) {
      throw new Error(
        `Invalid LLM response: updates[${i}] must have path, content, and reason strings`,
      );
    }
    return {
      path: update["path"],
      content: update["content"],
      reason: update["reason"],
    };
  });

  const newPages = (obj["newPages"] as unknown[]).map((p, i) => {
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error(`Invalid LLM response: newPages[${i}] must be an object`);
    }
    const page = p as Record<string, unknown>;
    if (
      typeof page["path"] !== "string" ||
      typeof page["content"] !== "string" ||
      typeof page["reason"] !== "string"
    ) {
      throw new Error(
        `Invalid LLM response: newPages[${i}] must have path, content, and reason strings`,
      );
    }
    return {
      path: page["path"],
      content: page["content"],
      reason: page["reason"],
    };
  });

  return {
    summary: { path: summary["path"], content: summary["content"] },
    updates,
    newPages,
    indexUpdate: obj["indexUpdate"] as string,
    logEntry: obj["logEntry"] as string,
  };
}

async function applyIngestResult(
  project: Project,
  result: IngestResult,
  sourceContent: string,
  sourceFilename: string,
): Promise<void> {
  // Write summary
  const summaryAbsPath = join(project.root, result.summary.path);
  assertWithinRoot(summaryAbsPath, project.root);
  await mkdir(dirname(summaryAbsPath), { recursive: true });
  await writeFile(summaryAbsPath, result.summary.content, "utf8");

  // Write updated pages
  for (const update of result.updates) {
    const absPath = join(project.root, update.path);
    assertWithinRoot(absPath, project.root);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, update.content, "utf8");
  }

  // Write new pages
  for (const newPage of result.newPages) {
    const absPath = join(project.root, newPage.path);
    assertWithinRoot(absPath, project.root);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, newPage.content, "utf8");
  }

  // Update _index.md
  const indexPath = join(project.wikiDir, "_index.md");
  await writeFile(indexPath, result.indexUpdate, "utf8");

  // Write source file to sources directory
  const sourceDestPath = join(project.sourcesDir, sourceFilename);
  await mkdir(project.sourcesDir, { recursive: true });
  await writeFile(sourceDestPath, sourceContent, "utf8");

  // Append to log.md
  const logPath = join(project.wikiDir, "log.md");
  const timestamp = new Date().toISOString().split("T")[0];
  const logLine = `- ${timestamp}: ${result.logEntry}\n`;
  await appendFile(logPath, logLine, "utf8");

  // Re-index
  await indexProject(project);
}

export async function ingestSource(
  project: Project,
  sourcePath: string,
  llm: LlmAdapter,
  options?: IngestOptions,
): Promise<IngestPlan> {
  const apply = options?.apply ?? false;

  // 1. Read source content
  const sourceContent = await readSource(sourcePath);

  // 2. Read current wiki index
  const indexPath = join(project.wikiDir, "_index.md");
  const currentIndex = await readFileSafe(indexPath);

  // 3. Read schema
  const schemaPath = join(project.kbDir, "schema.md");
  const schema = await readFileSafe(schemaPath);

  // 4. Build user message
  const userMessage = `## Wiki Schema
${schema}

## Current Wiki Index
${currentIndex}

## New Source: ${sourceContent.filename}
${sourceContent.content}

Integrate this source into the wiki following the schema above.`;

  // 5. Call LLM
  const raw = await llm.complete(
    [{ role: "user", content: userMessage }],
    SYSTEM_PROMPT,
  );

  // 6. Parse response
  const result = parseIngestResult(raw);

  // 7. Apply if requested
  if (apply) {
    await applyIngestResult(
      project,
      result,
      sourceContent.content,
      sourceContent.filename,
    );
  }

  const sourceFile = join(project.sourcesDir, sourceContent.filename);

  return {
    result,
    sourceFile,
    dryRun: !apply,
  };
}
