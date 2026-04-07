import type { ParsedPage } from "./markdown.js";

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
