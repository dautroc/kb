import { readFile } from "node:fs/promises";
import matter from "gray-matter";
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const H1_RE = /^#\s+(.+)$/m;
function extractTitle(fm, content, relativePath) {
    if (typeof fm["title"] === "string" && fm["title"].trim() !== "") {
        return fm["title"].trim();
    }
    const h1Match = H1_RE.exec(content);
    if (h1Match) {
        return h1Match[1].trim();
    }
    // Fallback: use filename without extension
    const filename = relativePath.split("/").pop() ?? relativePath;
    return filename.replace(/\.md$/i, "");
}
function extractTags(fm) {
    const tags = fm["tags"];
    if (!Array.isArray(tags))
        return "";
    return tags.filter((t) => typeof t === "string").join(",");
}
function extractWikiLinks(content) {
    const links = [];
    let match;
    const re = new RegExp(WIKILINK_RE.source, "g");
    while ((match = re.exec(content)) !== null) {
        links.push(match[1].trim());
    }
    return links;
}
function countWords(text) {
    const trimmed = text.trim();
    if (trimmed === "")
        return 0;
    return trimmed.split(/\s+/).length;
}
export async function parsePage(filePath, relativePath, rawContent) {
    const raw = rawContent ?? (await readFile(filePath, "utf8"));
    const parsed = matter(raw);
    const fm = parsed.data;
    const content = parsed.content;
    const title = extractTitle(fm, content, relativePath);
    const tags = extractTags(fm);
    const outgoingLinks = extractWikiLinks(content);
    const wordCount = countWords(content);
    return {
        path: relativePath,
        title,
        content,
        tags,
        frontmatter: fm,
        outgoingLinks,
        wordCount,
    };
}
//# sourceMappingURL=markdown.js.map