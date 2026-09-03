/**
 * Pure text-processing for handbook ingestion — no db, no server-only. Split out of `handbook.ts`
 * so it can be unit-tested directly (importing `handbook.ts` pulls in `@/db`, which starts with
 * `import "server-only"` and throws unconditionally outside Next's bundler — including under
 * plain vitest, which doesn't set the `react-server` export condition either).
 */
import type { HandbookSection } from "@/db/schema";

/** Extract raw text from an uploaded handbook file. PDF via `pdf-parse`, DOCX via `mammoth`. */
export async function extractText(file: { name: string; bytes: Uint8Array }): Promise<string> {
  const lower = file.name.toLowerCase();
  const buffer = Buffer.from(file.bytes);

  if (lower.endsWith(".pdf")) {
    // Loaded lazily: pdf-parse (pdfjs) touches browser globals at import time and must never be
    // evaluated on a normal page render. Only the upload path pays for it.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith(".docx")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error("Unsupported handbook file type. Upload a PDF or DOCX.");
}

/** Cheap token estimate (chars/4), matching the brief. Good enough for admin display + budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toTitleCase(line: string): string {
  return line.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function chunkByWords(text: string, wordsPerChunk: number): HandbookSection[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const sections: HandbookSection[] = [];
  let n = 1;
  for (let i = 0; i < words.length; i += wordsPerChunk, n++) {
    const chunkWords = words.slice(i, i + wordsPerChunk);
    const body = chunkWords.join(" ");
    const heading = chunkWords.slice(0, 8).join(" ") + (chunkWords.length > 8 ? "…" : "");
    sections.push({ id: `§${n}`, heading, text: body, tokenEstimate: estimateTokens(body) });
  }
  return sections;
}

// "1.2 Heading text", "1.2) Heading", "1.2: Heading", "1.2 - Heading"
const NUMBERED_SUBHEADING = /^(\d{1,3})\.(\d{1,3})(?:\.\d{1,3})?\s*[).:-]?\s+(\S.*)$/;
// "6 Interior Design", "6. Interior Design"
const NUMBERED_TOP_HEADING = /^(\d{1,3})\s*[).:-]?\s+([A-Z][\S \-'’&,()/]{2,80})$/;
// A standalone, short, mostly-uppercase line — treated as a heading fallback.
const CAPS_HEADING = /^[A-Z][A-Z0-9 &'’\-.,()/]{3,79}$/;

/**
 * Pure: split extracted handbook text into sections with stable `§<n>` / `§<n>.<m>` ids.
 * Heuristic, in order: explicit numbered subheadings ("6.2 Interior design proofs"), numbered
 * top-level headings ("6 Interior design"), then standalone ALL-CAPS short lines. A heading
 * candidate only counts if it stands alone on its own line (blank line before and after) — this
 * keeps ordinary sentences that start with a number ("3 things to expect") from being mistaken
 * for headings. Documents with no detectable headings fall back to ~1,200-word chunks.
 */
export function splitIntoSections(rawText: string): HandbookSection[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const isBlank = (s: string | undefined) => s === undefined || s.trim() === "";

  type Mark = { line: number; id: string; heading: string };
  const marks: Mark[] = [];
  let synthetic = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 100) continue;
    if (!(isBlank(lines[i - 1]) && isBlank(lines[i + 1]))) continue;

    const sub = line.match(NUMBERED_SUBHEADING);
    if (sub) {
      marks.push({ line: i, id: `§${sub[1]}.${sub[2]}`, heading: sub[3].trim() });
      continue;
    }
    const top = line.match(NUMBERED_TOP_HEADING);
    if (top) {
      marks.push({ line: i, id: `§${top[1]}`, heading: top[2].trim() });
      continue;
    }
    if (CAPS_HEADING.test(line) && /[A-Z]{2,}/.test(line)) {
      synthetic += 1;
      marks.push({ line: i, id: `§${synthetic}`, heading: toTitleCase(line) });
    }
  }

  if (marks.length === 0) return chunkByWords(rawText, 1200);

  const sections: HandbookSection[] = [];
  for (let m = 0; m < marks.length; m++) {
    const start = marks[m].line + 1;
    const end = m + 1 < marks.length ? marks[m + 1].line : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    if (!body) continue;
    sections.push({ id: marks[m].id, heading: marks[m].heading, text: body, tokenEstimate: estimateTokens(body) });
  }
  if (sections.length === 0) return chunkByWords(rawText, 1200);

  // Guarantee unique ids (a document could plausibly repeat a heading number).
  const seen = new Map<string, number>();
  for (const s of sections) {
    const count = (seen.get(s.id) ?? 0) + 1;
    seen.set(s.id, count);
    if (count > 1) s.id = `${s.id}.${count}`;
  }
  return sections;
}
