/**
 * Pure prompt assembly — no db, no server-only. Safe to import from route handlers, the eval
 * CLI script, and tests alike.
 */
import type { ModelMessage, SystemModelMessage } from "ai";
import type { HandbookSection } from "@/db/schema";
import type { AssistantProvider } from "@/lib/types";

/** Exact refusal phrase the model is instructed to use; `citations.ts` matches on it. */
export const NOT_IN_HANDBOOK_PHRASE = "That's not something I can find in the Author Handbook";

export const SYSTEM_PROMPT = `You are the Atmosphere Press Author Portal assistant. You help authors understand the Atmosphere production process by answering questions using ONLY the Author Handbook text provided below.

Rules:
- Answer only from the Author Handbook block that follows. Do not use outside knowledge of publishing, and do not guess.
- If the handbook does not cover the question, say so plainly, for example: "${NOT_IN_HANDBOOK_PHRASE}, so please ask your Author Manager." Do not add a Sources line in that case.
- Never speculate about THIS author's specific dates, money, or contract terms — those live in HubSpot, not the handbook. Point the author to their Author Manager or their dashboard for anything specific to their own book.
- Speak directly to the author in second person ("you", "your book"). Be plain, warm, and concise — a few short paragraphs at most, no headers or bullet spam for a simple question.
- End every answer that draws on the handbook with a final line, on its own, listing every section id you used, in exactly this form:
Sources: §1.2, §4.1`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type BuildPromptInput = {
  provider: AssistantProvider;
  handbookSections: HandbookSection[];
  bookTitle?: string | null;
  stageLabel?: string | null;
  /** Prior turns, oldest first, NOT including the current question. Caller should already cap this (brief: last 10 turns). */
  history: ChatTurn[];
  question: string;
};

export function buildHandbookBlock(sections: HandbookSection[]): string {
  if (sections.length === 0) {
    return "The Author Handbook has not been uploaded yet. If asked anything, say it isn't available yet and to check back soon.";
  }
  return sections.map((s) => `[${s.id} ${s.heading}]\n${s.text}`).join("\n\n");
}

const MAX_HISTORY_TURNS = 10;

/**
 * Builds the full prompt in the brief's required order: system prompt, handbook block (with a
 * per-provider caching hint), author context, history, question.
 *
 * - Anthropic: the handbook block gets `providerOptions.anthropic.cacheControl = { type:
 *   "ephemeral" }`, which marks a prompt-cache breakpoint at the end of that block. Everything
 *   before the breakpoint (system prompt + handbook) is cached; author context/history/question
 *   come after it and can vary per request without invalidating the cache.
 * - OpenAI: no explicit action needed — the Responses/Chat Completions API auto-caches matching
 *   prompt prefixes over ~1024 tokens (`promptCacheOptions`/`promptCacheKey` exist for
 *   fine-tuning cache behavior but aren't required for the cache itself to kick in).
 * - Google: `@ai-sdk/google` only exposes `providerOptions.google.cachedContent`, a reference to
 *   a *pre-created* Gemini context-cache resource (created via a separate Gemini caching API
 *   call with its own TTL/lifecycle). That resource-management step is not implemented here —
 *   Google requests are sent uncached. See the final report.
 */
export function buildPrompt(input: BuildPromptInput): { instructions: SystemModelMessage[]; messages: ModelMessage[] } {
  const handbookBlock = buildHandbookBlock(input.handbookSections);

  const instructions: SystemModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Author Handbook (grounding source — cite section ids exactly as shown in brackets):\n\n${handbookBlock}`,
      ...(input.provider === "anthropic"
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } } }
        : {}),
    },
  ];

  const contextLine = [
    input.bookTitle ? `Book: ${input.bookTitle}.` : null,
    input.stageLabel ? `Current stage: ${input.stageLabel}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (contextLine) {
    instructions.push({ role: "system", content: contextLine });
  }

  const messages: ModelMessage[] = [
    ...input.history.slice(-MAX_HISTORY_TURNS).map((t): ModelMessage => ({ role: t.role, content: t.content })),
    { role: "user", content: input.question },
  ];

  return { instructions, messages };
}
