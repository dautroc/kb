import { readFile } from "node:fs/promises";
import matter from "gray-matter";

export interface CrossLink {
  project: string;
  path: string;
}

export interface ParsedPage {
  path: string;
  title: string;
  content: string;
  tags: string;
  frontmatter: Record<string, unknown>;
  outgoingLinks: string[];
  outgoingCrossLinks: CrossLink[];
  wordCount: number;
}

// Matches [[kb://project-name/path/to/page]] and [[kb://project-name/path/to/page|display]]
const CROSS_LINK_RE = /\[\[kb:\/\/([^/\]]+)\/([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
// Matches [[page-name]] and [[page-name|display]] — excludes kb:// prefixed links
const WIKILINK_RE = /\[\[(?!kb:\/\/)([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
const H1_RE = /^#\s+(.+)$/m;

function extractTitle(
  fm: Record<string, unknown>,
  content: string,
  relativePath: string,
): string {
  if (typeof fm["title"] === "string" && fm["title"].trim() !== "") {
    return fm["title"].trim();
  }
  const h1Match = H1_RE.exec(content);
  if (h1Match) {
    return h1Match[1]!.trim();
  }
  const filename = relativePath.split("/").pop() ?? relativePath;
  return filename.replace(/\.md$/i, "");
}

function extractTags(fm: Record<string, unknown>): string {
  const tags = fm["tags"];
  if (!Array.isArray(tags)) return "";
  return tags.filter((t): t is string => typeof t === "string").join(",");
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    links.push(match[1]!.trim());
  }
  return links;
}

function extractCrossLinks(content: string): CrossLink[] {
  const links: CrossLink[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CROSS_LINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    links.push({ project: match[1]!.trim(), path: match[2]!.trim() });
  }
  return links;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

export async function parsePage(
  filePath: string,
  relativePath: string,
  rawContent?: string,
): Promise<ParsedPage> {
  const raw = rawContent ?? (await readFile(filePath, "utf8"));
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const content = parsed.content;

  const title = extractTitle(fm, content, relativePath);
  const tags = extractTags(fm);
  const outgoingLinks = extractWikiLinks(content);
  const outgoingCrossLinks = extractCrossLinks(content);
  const wordCount = countWords(content);

  return {
    path: relativePath,
    title,
    content,
    tags,
    frontmatter: fm,
    outgoingLinks,
    outgoingCrossLinks,
    wordCount,
  };
}
