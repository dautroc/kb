import { createHash } from "node:crypto";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parsePage } from "./markdown.js";
import { openDb, closeDb } from "./db.js";
async function collectMdFiles(dir) {
    try {
        const entries = await readdir(dir, {
            recursive: true,
            withFileTypes: true,
        });
        return (entries
            .filter((e) => e.isFile() && e.name.endsWith(".md"))
            // parentPath added Node 21.4+; fall back to the pre-deprecation path property
            .map((e) => join(e.parentPath ?? e.path, e.name)));
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
        return [];
    }
}
function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}
function upsertParsedPage(stmts, project, page, hash, mtime) {
    stmts.deletePages.run(page.path);
    stmts.insertPage.run(page.path, page.title, page.content, page.tags, project.name);
    stmts.upsertMeta.run(page.path, hash, mtime, page.wordCount, JSON.stringify(page.frontmatter), JSON.stringify(page.outgoingLinks), Date.now());
}
export async function indexProject(project, rebuild = false) {
    const db = openDb(project);
    try {
        if (rebuild) {
            db.exec("DELETE FROM pages; DELETE FROM page_meta;");
        }
        const files = await collectMdFiles(project.wikiDir);
        const stats = { indexed: 0, skipped: 0, deleted: 0, errors: 0 };
        const getMetaStmt = db.prepare("SELECT sha256 FROM page_meta WHERE path = ?");
        const upsertStmts = {
            deletePages: db.prepare("DELETE FROM pages WHERE path = ?"),
            insertPage: db.prepare("INSERT INTO pages(path, title, content, tags, project) VALUES (?, ?, ?, ?, ?)"),
            upsertMeta: db.prepare(`
        INSERT INTO page_meta(path, sha256, mtime, word_count, frontmatter, outgoing_links, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          word_count = excluded.word_count,
          frontmatter = excluded.frontmatter,
          outgoing_links = excluded.outgoing_links,
          updated_at = excluded.updated_at
      `),
        };
        const deleteStalePages = db.prepare("DELETE FROM pages WHERE path = ?");
        const deleteStaleMeta = db.prepare("DELETE FROM page_meta WHERE path = ?");
        const listMetaStmt = db.prepare("SELECT path FROM page_meta");
        const processFile = db.transaction((page, hash, mtime) => {
            upsertParsedPage(upsertStmts, project, page, hash, mtime);
        });
        const onDiskPaths = new Set();
        for (const absPath of files) {
            const relPath = relative(project.root, absPath);
            onDiskPaths.add(relPath);
            let raw;
            try {
                raw = await readFile(absPath, "utf8");
            }
            catch (err) {
                stats.errors++;
                continue;
            }
            const hash = sha256(raw);
            const existing = getMetaStmt.get(relPath);
            if (existing && existing.sha256 === hash) {
                stats.skipped++;
                continue;
            }
            let fileStat;
            try {
                fileStat = await stat(absPath);
            }
            catch {
                stats.errors++;
                continue;
            }
            let page;
            try {
                page = await parsePage(absPath, relPath, raw);
            }
            catch {
                stats.errors++;
                continue;
            }
            try {
                processFile(page, hash, Math.floor(fileStat.mtimeMs));
                stats.indexed++;
            }
            catch {
                stats.errors++;
            }
        }
        // Remove entries for deleted files
        const allMetaPaths = listMetaStmt.all().map((r) => r.path);
        const stalePaths = allMetaPaths.filter((p) => !onDiskPaths.has(p));
        const deleteStale = db.transaction((paths) => {
            for (const p of paths) {
                deleteStalePages.run(p);
                deleteStaleMeta.run(p);
            }
        });
        deleteStale(stalePaths);
        stats.deleted += stalePaths.length;
        return stats;
    }
    finally {
        closeDb(db);
    }
}
//# sourceMappingURL=indexer.js.map