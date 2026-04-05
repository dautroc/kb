// packages/core/src/log-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseLogEntries } from "./log-parser.js";

describe("parseLogEntries", () => {
  it("returns empty array for empty string", () => {
    expect(parseLogEntries("")).toEqual([]);
  });

  it("returns empty array when only top-level heading exists", () => {
    expect(parseLogEntries("# Activity Log\n")).toEqual([]);
  });

  it("parses a single entry", () => {
    const content =
      "# Activity Log\n\n## 2026-01-01 — Init\n\nProject initialized.\n";
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.heading).toBe("2026-01-01 — Init");
    expect(entries[0]!.body).toBe("Project initialized.");
  });

  it("parses multiple entries", () => {
    const content = [
      "# Activity Log",
      "",
      "## 2026-01-01 — Init",
      "",
      "Initialized.",
      "",
      "## 2026-01-02 — Ingest paper.pdf",
      "",
      "Added summary.",
    ].join("\n");
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.heading).toBe("2026-01-01 — Init");
    expect(entries[1]!.heading).toBe("2026-01-02 — Ingest paper.pdf");
  });

  it("handles entry with no body", () => {
    const content = "## 2026-01-01 — No body";
    const entries = parseLogEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.body).toBe("");
  });

  it("preserves multi-line body", () => {
    const content = "## 2026-01-01 — Entry\n\nLine 1.\nLine 2.\nLine 3.";
    const entries = parseLogEntries(content);
    expect(entries[0]!.body).toContain("Line 1.");
    expect(entries[0]!.body).toContain("Line 3.");
  });
});
