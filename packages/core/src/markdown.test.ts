import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePage } from "./markdown.js";

describe("parsePage", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-markdown-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses frontmatter title when present", async () => {
    const filePath = join(tmpDir, "page.md");
    await writeFile(
      filePath,
      `---
title: My Frontmatter Title
tags: [foo, bar]
---

# Different H1

Some content here.
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/page.md");
    expect(page.title).toBe("My Frontmatter Title");
  });

  it("falls back to H1 heading when no frontmatter title", async () => {
    const filePath = join(tmpDir, "page.md");
    await writeFile(
      filePath,
      `---
tags: [concept]
---

# The Real Title

Some content here.
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/page.md");
    expect(page.title).toBe("The Real Title");
  });

  it("falls back to filename when no frontmatter title or H1", async () => {
    const filePath = join(tmpDir, "my-page.md");
    await writeFile(filePath, "Just some plain content.", "utf8");
    const page = await parsePage(filePath, "wiki/my-page.md");
    expect(page.title).toBe("my-page");
  });

  it("extracts [[wikilinks]] from content", async () => {
    const filePath = join(tmpDir, "links.md");
    await writeFile(
      filePath,
      `---
title: Links Page
---

See [[related-concept]] and [[another-page|display text]] for details.
Also check [[sub/nested-page]].
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/links.md");
    expect(page.outgoingLinks).toContain("related-concept");
    expect(page.outgoingLinks).toContain("another-page");
    expect(page.outgoingLinks).toContain("sub/nested-page");
    expect(page.outgoingLinks).toHaveLength(3);
  });

  it("extracts tags as comma-separated string", async () => {
    const filePath = join(tmpDir, "tagged.md");
    await writeFile(
      filePath,
      `---
title: Tagged Page
tags: [alpha, beta, gamma]
---

Content.
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/tagged.md");
    expect(page.tags).toBe("alpha,beta,gamma");
  });

  it("returns empty tags string when no tags in frontmatter", async () => {
    const filePath = join(tmpDir, "no-tags.md");
    await writeFile(filePath, `---\ntitle: No Tags\n---\n\nContent.\n`, "utf8");
    const page = await parsePage(filePath, "wiki/no-tags.md");
    expect(page.tags).toBe("");
  });

  it("counts words in content", async () => {
    const filePath = join(tmpDir, "words.md");
    await writeFile(
      filePath,
      `---
title: Word Count
---

one two three four five
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/words.md");
    expect(page.wordCount).toBe(5);
  });

  it("stores full frontmatter in frontmatter field", async () => {
    const filePath = join(tmpDir, "fm.md");
    await writeFile(
      filePath,
      `---
title: FM Page
created: 2026-01-01
custom: value
---

Content.
`,
      "utf8",
    );
    const page = await parsePage(filePath, "wiki/fm.md");
    // gray-matter parses YAML date strings as Date objects
    const created = page.frontmatter["created"];
    const createdStr =
      created instanceof Date ? created.toISOString().slice(0, 10) : created;
    expect(createdStr).toBe("2026-01-01");
    expect(page.frontmatter["custom"]).toBe("value");
  });
});
