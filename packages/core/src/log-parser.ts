// packages/core/src/log-parser.ts

export interface ParsedLogEntry {
  heading: string;
  body: string;
}

/**
 * Parses a log.md file into an array of entries.
 * Each entry starts with a level-2 heading (## ...).
 * The top-level "# Activity Log" heading is skipped.
 */
export function parseLogEntries(content: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const sections = content.split(/^(?=## )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) continue;
    if (!trimmed.startsWith("## ")) continue;

    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) {
      entries.push({ heading: trimmed.slice(3).trim(), body: "" });
    } else {
      const heading = trimmed.slice(3, newlineIdx).trim();
      const body = trimmed.slice(newlineIdx + 1).trim();
      entries.push({ heading, body });
    }
  }

  return entries;
}
