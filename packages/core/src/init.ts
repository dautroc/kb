import { mkdir, writeFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import TOML from "@iarna/toml";

export interface InitOptions {
  name: string;
  directory: string; // absolute path where to init
}

function resolveProjectName(options: InitOptions): string {
  return options.name || basename(options.directory);
}

function buildConfigToml(projectName: string): string {
  const config = {
    project: {
      name: projectName,
      version: "0.1.0",
    },
    directories: {
      sources: "sources",
      wiki: "wiki",
    },
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
  };

  const tomlStr = TOML.stringify(config as TOML.JsonMap);
  return (
    tomlStr +
    '\n[dependencies]\n# shared-glossary = { path = "../shared-glossary" }\n'
  );
}

function buildSchemaMd(): string {
  return `# KB Schema — LLM Instructions

This file defines the conventions for this knowledge base. The \`kb\` CLI and any
LLM operating on this wiki MUST follow these rules.

---

## Wiki Structure Conventions

- All pages live under the \`wiki/\` directory.
- \`wiki/_index.md\` is the wiki root and serves as a table of contents.
- Sub-topics may be organised into sub-directories: \`wiki/<topic>/_index.md\`.
- File names use kebab-case, e.g. \`wiki/authentication-flow.md\`.
- Every page must have a valid YAML frontmatter block.

---

## Frontmatter Schema

Every wiki page must begin with a YAML frontmatter block:

\`\`\`yaml
---
title: <Human-readable page title>
tags: [tag1, tag2]        # optional; array of lowercase strings
created: <ISO 8601 date>  # e.g. 2026-04-05
updated: <ISO 8601 date>  # updated whenever content changes
source: <path or URL>     # optional; original source material
---
\`\`\`

Required fields: \`title\`, \`created\`.

---

## Page Templates

### Entity Page
Use for: people, systems, services, tools.

\`\`\`markdown
---
title: <Entity Name>
tags: [entity]
created: <ISO date>
updated: <ISO date>
---

# <Entity Name>

**Type**: <system | person | service | tool>

## Overview

<One-paragraph description.>

## Key Attributes

- **Attribute**: value

## Related

- [[related-page]]
\`\`\`

### Concept Page
Use for: ideas, patterns, terminology.

\`\`\`markdown
---
title: <Concept Name>
tags: [concept]
created: <ISO date>
updated: <ISO date>
---

# <Concept Name>

## Definition

<Clear definition in 1-3 sentences.>

## Context

<When and why this concept matters in the project.>

## See Also

- [[related-concept]]
\`\`\`

### Source Summary Page
Use for: summarised source material (docs, papers, meetings).

\`\`\`markdown
---
title: Summary — <Source Title>
tags: [source-summary]
created: <ISO date>
source: <path or URL>
---

# Summary — <Source Title>

## Key Points

- Point one
- Point two

## Decisions / Implications

<What this source means for the project.>

## Raw Source

See \`sources/<filename>\`.
\`\`\`

### Comparison Page
Use for: side-by-side evaluation of options.

\`\`\`markdown
---
title: Comparison — <Topic>
tags: [comparison]
created: <ISO date>
updated: <ISO date>
---

# Comparison — <Topic>

| Criterion | Option A | Option B |
|-----------|----------|----------|
| ...       | ...      | ...      |

## Recommendation

<Which option and why.>
\`\`\`

---

## Wikilink Conventions

- Basic link: \`[[page-name]]\` — links to \`wiki/page-name.md\`.
- Display text: \`[[page-name|display text]]\` — renders as "display text".
- Cross-directory: \`[[topic/sub-page]]\`.
- All wikilink targets must be lowercase kebab-case matching the file name without \`.md\`.

---

## Ingest Workflow

1. Place the source file in \`sources/\` (PDF, Markdown, plain text, etc.).
2. Run \`kb ingest sources/<filename>\`.
3. The CLI reads the file, calls the configured LLM, and generates a source-summary
   page in \`wiki/\`.
4. The summary page is linked from \`wiki/_index.md\` under **Sources**.
5. An entry is appended to \`log.md\`.

---

## Query Workflow

1. Run \`kb query "<natural-language question>"\`.
2. The CLI searches the wiki index for relevant pages.
3. Relevant page content is assembled into a prompt context.
4. The LLM answers the question, citing wikilinks.
5. The answer is printed to stdout. Nothing is written to disk unless \`--save\` is passed.

---

## Lint Workflow

Run \`kb lint\` to check for:

- Pages missing required frontmatter fields (\`title\`, \`created\`).
- Broken wikilinks (targets that don't resolve to an existing page).
- Pages not reachable from \`wiki/_index.md\`.
- Duplicate page titles across the wiki.
- Frontmatter fields with invalid types or formats.

Lint exits with code 0 on success, 1 if errors are found.
`;
}

function buildIndexMd(projectName: string, isoDate: string): string {
  return `---
title: ${projectName} Knowledge Base
created: ${isoDate}
---

# ${projectName} Knowledge Base

> This wiki is maintained by the \`kb\` CLI tool.

## Pages

(No pages yet. Use \`kb ingest <source>\` to add content.)

## Sources

(No sources yet.)
`;
}

function buildLogMd(projectName: string, isoDate: string): string {
  return `# Activity Log

## ${isoDate} — Project initialized

Project \`${projectName}\` initialized.
`;
}

async function kbDirExists(directory: string): Promise<boolean> {
  try {
    await access(join(directory, ".kb"));
    return true;
  } catch {
    return false;
  }
}

export async function initProject(options: InitOptions): Promise<void> {
  const projectName = resolveProjectName(options);
  const { directory } = options;

  if (await kbDirExists(directory)) {
    throw new Error(
      `Knowledge base already initialized: .kb/ already exists in ${directory}`,
    );
  }

  const isoDate = new Date().toISOString().split("T")[0]!;

  // Create directory structure
  await mkdir(join(directory, ".kb"), { recursive: true });
  await mkdir(join(directory, "sources"), { recursive: true });
  await mkdir(join(directory, "wiki"), { recursive: true });

  // Write files
  await writeFile(
    join(directory, ".kb", "config.toml"),
    buildConfigToml(projectName),
    "utf8",
  );
  await writeFile(join(directory, ".kb", "schema.md"), buildSchemaMd(), "utf8");
  await writeFile(join(directory, "sources", ".gitkeep"), "", "utf8");
  await writeFile(
    join(directory, "wiki", "_index.md"),
    buildIndexMd(projectName, isoDate),
    "utf8",
  );
  await writeFile(
    join(directory, "log.md"),
    buildLogMd(projectName, isoDate),
    "utf8",
  );
}
