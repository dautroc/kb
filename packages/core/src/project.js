import { access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { parseConfig } from "./config.js";
async function hasKbDir(dir) {
    try {
        await access(join(dir, ".kb", "config.toml"));
        return true;
    }
    catch {
        return false;
    }
}
async function findProjectRoot(startDir) {
    let current = resolve(startDir);
    while (true) {
        if (await hasKbDir(current)) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            // Reached filesystem root
            return null;
        }
        current = parent;
    }
}
export async function loadProject(startDir) {
    const root = await findProjectRoot(startDir);
    if (root === null) {
        throw new Error(`No kb project found. Run "kb init" to initialize a knowledge base in the current directory.`);
    }
    const kbDir = join(root, ".kb");
    const configPath = join(kbDir, "config.toml");
    const config = await parseConfig(configPath);
    return {
        name: config.project.name,
        root,
        kbDir,
        sourcesDir: join(root, config.directories.sources),
        wikiDir: join(root, config.directories.wiki),
        config,
    };
}
export async function tryLoadProject(startDir) {
    try {
        return await loadProject(startDir);
    }
    catch (err) {
        if (err instanceof Error && /no kb project found/i.test(err.message)) {
            return null;
        }
        throw err;
    }
}
//# sourceMappingURL=project.js.map