/** Pure — no db, no server-only. Safe to import from the client (AssistantPanel) and the server (route.ts). */
import type { HandbookSection } from "@/db/schema";
import type { ChatCitation } from "@/lib/types";
import { NOT_IN_HANDBOOK_PHRASE } from "./prompt";

// Matches a trailing "Sources: §1.2, §4.1" line, on its own line, at the very end of the answer.
const SOURCES_LINE = /(^|\n)[ \t]*Sources:[ \t]*(.*)$/i;
const SECTION_ID = /§[\w.]+/g;

/** Strip the trailing "Sources:" line, without needing to know the handbook sections. Used for
 *  live display while a message is still streaming (citations aren't resolved yet at that point). */
export function stripSourcesLine(text: string): { text: string; hadSourcesLine: boolean } {
  const trimmed = text.trimEnd();
  const match = trimmed.match(SOURCES_LINE);
  if (!match || match.index === undefined) return { text: trimmed, hadSourcesLine: false };
  return { text: trimmed.slice(0, match.index).trimEnd(), hadSourcesLine: true };
}

export function isNotInHandbook(answerText: string): boolean {
  return answerText.toLowerCase().includes(NOT_IN_HANDBOOK_PHRASE.toLowerCase());
}

export type ParsedAnswer = {
  /** The answer with the trailing "Sources:" line removed. */
  answer: string;
  citations: ChatCitation[];
  notInHandbook: boolean;
};

/**
 * Parse the trailing "Sources: §1.2, §4.1" line into `ChatCitation[]`, resolving each id against
 * the active handbook's sections (unknown ids — e.g. a hallucinated one — are silently dropped).
 * Also strips that line from the returned answer and flags the standard refusal phrase.
 */
export function parseCitations(rawAnswer: string, sections: HandbookSection[]): ParsedAnswer {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const { text: answer, hadSourcesLine } = stripSourcesLine(rawAnswer);

  const citations: ChatCitation[] = [];
  if (hadSourcesLine) {
    const trimmed = rawAnswer.trimEnd();
    const match = trimmed.match(SOURCES_LINE);
    const ids = match?.[2]?.match(SECTION_ID) ?? [];
    const seen = new Set<string>();
    for (const raw of ids) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      const section = byId.get(raw);
      if (section) {
        citations.push({ sectionId: section.id, heading: section.heading, quote: section.text.slice(0, 240).trim() });
      }
    }
  }

  return { answer, citations, notInHandbook: isNotInHandbook(answer) };
}

/** Payload for the `data-citations` UI message stream part written by `POST /api/chat`. */
export type CitationsDataPart = {
  /** `chat_messages.id` for this answer, so the client can rate it. */
  dbId: string;
  citations: ChatCitation[];
  notInHandbook: boolean;
};

export type AssistantDataParts = { citations: CitationsDataPart };
