import { defineConfig } from "tsup";
import path from "path";

const coreDir = path.resolve(__dirname, "../core");
const mcpDir = path.resolve(__dirname, "../mcp-server");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "kb-core",
    "kb-mcp",
    new RegExp(coreDir.replace(/\\/g, "\\\\")),
    new RegExp(mcpDir.replace(/\\/g, "\\\\")),
    "better-sqlite3",
    "pdf-parse",
    "sharp",
    "chalk",
    "commander",
    "@anthropic-ai/sdk",
    "@iarna/toml",
    "gray-matter",
    "remark",
    "remark-frontmatter",
    "remark-wiki-link",
  ],
});
