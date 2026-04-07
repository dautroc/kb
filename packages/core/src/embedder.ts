import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ParsedPage } from "./markdown.js";
import { parsePage } from "./markdown.js";
import type { Project } from "./project.js";
import { openDb, closeDb } from "./db.js";

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export interface Chunk {
  page_path: string;
  heading: string;
  content: string;
  token_count: number;
  page_sha256: string;
}

export interface EmbedStats {
  embedded: number;
  skipped: number;
  errors: number;
}

const MIN_TOKENS = 20;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function splitAtParagraphs(
  text: string,
  chunkSize: number,
  heading: string,
  path: string,
  sha: string,
): Chunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (estimateTokens(candidate) > chunkSize && buffer) {
      const tc = estimateTokens(buffer);
      chunks.push({
        page_path: path,
        heading,
        content: buffer.trim(),
        token_count: tc,
        page_sha256: sha,
      });
      buffer = para;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) {
    const tc = estimateTokens(buffer);
    chunks.push({
      page_path: path,
      heading,
      content: buffer.trim(),
      token_count: tc,
      page_sha256: sha,
    });
  }
  return chunks.filter((c) => c.token_count >= MIN_TOKENS);
}

export function chunkPage(
  page: ParsedPage,
  chunkSize: number,
  pageSha256 = "",
): Chunk[] {
  const lines = page.content.split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,6})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.some((l) => l.trim())) {
        sections.push({ heading: currentHeading, lines: [...currentLines] });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some((l) => l.trim())) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  // If no headings found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({ heading: "", lines: lines });
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) continue;
    const tc = estimateTokens(text);
    if (tc <= chunkSize) {
      // For unsplit sections: exclude sections with headings that are too small
      if (section.heading === "" || tc >= MIN_TOKENS) {
        chunks.push({
          page_path: page.path,
          heading: section.heading,
          content: text,
          token_count: tc,
          page_sha256: pageSha256,
        });
      }
    } else {
      chunks.push(
        ...splitAtParagraphs(
          text,
          chunkSize,
          section.heading,
          page.path,
          pageSha256,
        ),
      );
    }
  }
  return chunks;
}

async function callOllamaEmbed(
  ollamaUrl: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(`${ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new OllamaUnavailableError(
      `Ollama unreachable: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new OllamaUnavailableError(`Ollama returned ${response.status}`);
  }
  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function embedProject(
  project: Project,
  options?: { rebuild?: boolean },
): Promise<EmbedStats> {
  const cfg = project.config.search ?? {
    embedding_provider: "ollama" as const,
    embedding_model: "nomic-embed-text",
    ollama_url: "http://localhost:11434",
    chunk_size: 900,
  };

  const db = openDb(project);
  try {
    if (options?.rebuild) {
      db.exec("DELETE FROM chunks; DELETE FROM chunks_vec;");
    }

    // Collect all wiki markdown files
    let files: string[] = [];
    try {
      const entries = await readdir(project.wikiDir, {
        recursive: true,
        withFileTypes: true,
      });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) =>
          join(
            (e as unknown as { parentPath?: string }).parentPath ??
              (e as unknown as { path?: string }).path ??
              project.wikiDir,
            e.name,
          ),
        );
    } catch {
      files = [];
    }

    const stats: EmbedStats = { embedded: 0, skipped: 0, errors: 0 };

    const getExistingHashStmt = db.prepare<[string], { page_sha256: string }>(
      "SELECT page_sha256 FROM chunks WHERE page_path = ? LIMIT 1",
    );
    const deleteVecStmt = db.prepare(
      "DELETE FROM chunks_vec WHERE rowid IN (SELECT id FROM chunks WHERE page_path = ?)",
    );
    const deleteChunksStmt = db.prepare(
      "DELETE FROM chunks WHERE page_path = ?",
    );
    const insertChunkStmt = db.prepare(
      "INSERT INTO chunks (page_path, heading, content, token_count, page_sha256) VALUES (?, ?, ?, ?, ?)",
    );
    const insertVecStmt = db.prepare(
      "INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)",
    );

    for (const absPath of files) {
      const relPath = relative(project.root, absPath);
      let raw: string;
      try {
        raw = await readFile(absPath, "utf8");
      } catch {
        stats.errors++;
        continue;
      }

      const hash = sha256(raw);

      if (!options?.rebuild) {
        const existing = getExistingHashStmt.get(relPath);
        if (existing && existing.page_sha256 === hash) {
          stats.skipped++;
          continue;
        }
      }

      let page: Awaited<ReturnType<typeof parsePage>>;
      try {
        page = await parsePage(absPath, relPath, raw);
      } catch {
        stats.errors++;
        continue;
      }

      const chunks = chunkPage(page, cfg.chunk_size, hash);
      if (chunks.length === 0) {
        stats.skipped++;
        continue;
      }

      const inputs = chunks.map((c) => c.content);
      let embeddings: number[][];
      try {
        embeddings = await callOllamaEmbed(
          cfg.ollama_url,
          cfg.embedding_model,
          inputs,
        );
      } catch (err) {
        if (err instanceof OllamaUnavailableError) throw err;
        stats.errors++;
        continue;
      }

      if (embeddings[0]?.length !== 768) {
        throw new Error(
          `Model returned ${embeddings[0]?.length ?? 0}-dim vectors, expected 768. Update embedding_model.`,
        );
      }

      db.transaction(() => {
        deleteVecStmt.run(relPath);
        deleteChunksStmt.run(relPath);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const info = insertChunkStmt.run(
            chunk.page_path,
            chunk.heading,
            chunk.content,
            chunk.token_count,
            chunk.page_sha256,
          );
          const vecBuf = Buffer.from(new Float32Array(embeddings[i]).buffer);
          insertVecStmt.run(BigInt(info.lastInsertRowid), vecBuf);
        }
      })();

      stats.embedded++;
    }

    return stats;
  } finally {
    closeDb(db);
  }
}
