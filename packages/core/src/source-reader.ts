import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export type SourceType = "markdown" | "text" | "pdf" | "url";

export interface SourceContent {
  type: SourceType;
  originalPath: string;
  content: string;
  filename: string;
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/\s/g, "-");
}

function detectType(sourcePath: string): SourceType {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    return "url";
  }
  const ext = extname(sourcePath).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".md") return "markdown";
  return "text";
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    const pagePart = last
      ? last.includes(".")
        ? last
        : `${last}.html`
      : "index.html";
    return sanitizeFilename(`${parsed.hostname}-${pagePart}`);
  } catch {
    return "url-content.html";
  }
}

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

async function readPdf(filePath: string): Promise<string> {
  const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
    await import("pdf-parse")
      .then((m) => m.default ?? m)
      .catch(() => {
        throw new Error(
          "PDF support requires pdf-parse: run `npm install pdf-parse` in your project",
        );
      });
  const buffer = await readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("169.254.") || // link-local
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

async function fetchUrl(url: string): Promise<string> {
  if (isPrivateUrl(url)) {
    throw new Error(`Fetching private/localhost URLs is not allowed: ${url}`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const html = await response.text();
  return stripHtml(html);
}

export async function readSource(sourcePath: string): Promise<SourceContent> {
  const type = detectType(sourcePath);

  if (type === "url") {
    const content = await fetchUrl(sourcePath);
    const filename = filenameFromUrl(sourcePath);
    return { type, originalPath: sourcePath, content, filename };
  }

  if (type === "pdf") {
    const content = await readPdf(sourcePath);
    const raw = basename(sourcePath);
    const filename = sanitizeFilename(raw);
    return { type, originalPath: sourcePath, content, filename };
  }

  // markdown or text
  const content = await readFile(sourcePath, "utf8");
  const raw = basename(sourcePath);
  const filename = sanitizeFilename(raw);
  return { type, originalPath: sourcePath, content, filename };
}
