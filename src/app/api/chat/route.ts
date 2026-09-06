import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, gte } from "drizzle-orm";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";
import type { ModelMessage, UIMessage } from "ai";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { effectiveUserId, requireUser } from "@/lib/session";
import { getBookForUser } from "@/lib/data/books";
import { getActiveModel } from "@/lib/assistant/providers";
import { getActiveHandbook } from "@/lib/assistant/handbook";
import { buildPrompt, type ChatTurn } from "@/lib/assistant/prompt";
import { parseCitations, type AssistantDataParts } from "@/lib/assistant/citations";

export const runtime = "nodejs";

/** Author-facing daily question cap (brief: 40/day, counted from `chat_messages` since midnight UTC). */
const CHAT_MESSAGES_MAX_PER_DAY = 40;
/** Brief: "history (last 10 turns)". Interpreted as the 10 most recent messages (user+assistant combined). */
const HISTORY_TURNS = 10;
/**
 * Long-running conversations used to error outright once `useChat` sent more than 50 UI messages
 * (the whole conversation is resent on every turn) — a chatty author asking a 26th question would
 * fail validation entirely. `AssistantPanel` now trims to this many messages before sending, but
 * the route enforces it too: the cap below is generous (well above what any legitimate client
 * request should carry) purely so a request that somehow arrives untrimmed still gets a normal 400
 * instead of never being accepted, and we slice down to the same limit before building the prompt.
 */
const MAX_UI_MESSAGES = 400;
const RECENT_UI_MESSAGES = 20;

// Loose validation for the AI SDK v5+ UIMessage shape sent by `useChat`'s DefaultChatTransport
// (`{ id, messages, trigger, messageId, ...extraBody }`). We don't attempt to fully validate
// every `parts[]` variant here — `convertToModelMessages` does the real structural work and we
// surface any failure as a 400 below.
const uiMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
  metadata: z.unknown().optional(),
});

const bodySchema = z.object({
  id: z.string().optional(),
  bookId: z.string().uuid().optional(),
  trigger: z.string().optional(),
  messageId: z.string().nullable().optional(),
  messages: z.array(uiMessageSchema).min(1).max(MAX_UI_MESSAGES),
});

function modelMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => ("text" in part ? part.text : "")).join("");
}

export async function POST(request: Request) {
  const user = await requireUser();
  const userId = effectiveUserId(user);

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't formatted the way we expected." }, { status: 400 });
  }
  const { bookId } = parsed.data;
  // Defense in depth: AssistantPanel already trims to the last 20 messages before sending, but the
  // route re-slices here too in case a request ever arrives untrimmed (see MAX_UI_MESSAGES above).
  const uiMessages = parsed.data.messages.slice(-RECENT_UI_MESSAGES);

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const [{ value: usedToday }] = await db
    .select({ value: count() })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), gte(chatMessages.createdAt, startOfDayUtc)));
  if (usedToday >= CHAT_MESSAGES_MAX_PER_DAY) {
    return NextResponse.json(
      { error: "You've reached today's limit of 40 questions. Please try again tomorrow, or ask your main contact directly." },
      { status: 429 },
    );
  }

  const active = await getActiveModel();
  if (!active) {
    return NextResponse.json({ error: "The assistant isn't set up yet. Please reach out to your main contact." }, { status: 503 });
  }

  // Ownership-checked: getBookForUser returns null (never data) if this user doesn't own bookId.
  const book = bookId ? await getBookForUser(userId, bookId) : null;

  const handbook = await getActiveHandbook();
  const sections = handbook?.sections ?? [];

  let modelMessages: ModelMessage[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelMessages = await convertToModelMessages(uiMessages as any);
  } catch {
    return NextResponse.json({ error: "That message couldn't be read." }, { status: 400 });
  }

  const last = modelMessages.at(-1);
  if (!last || last.role !== "user") {
    return NextResponse.json({ error: "The last message must be from you." }, { status: 400 });
  }
  const question = modelMessageText(last);
  const history: ChatTurn[] = modelMessages
    .slice(0, -1)
    .filter((m): m is ModelMessage & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: modelMessageText(m) }));

  const { instructions, messages } = buildPrompt({
    provider: active.provider,
    handbookSections: sections,
    bookTitle: book?.title ?? null,
    stageLabel: book?.currentStage?.label ?? null,
    history,
    question,
  });

  const dbId = crypto.randomUUID();
  const startedAt = Date.now();

  // Shared with AssistantPanel.tsx via `AssistantDataParts` so the client can type the
  // `data-citations` part it reads off `message.parts`.
  type AssistantUIMessage = UIMessage<unknown, AssistantDataParts>;

  const stream = createUIMessageStream<AssistantUIMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: active.model,
        instructions,
        messages,
        onFinish: async ({ text, usage }) => {
          const { answer, citations, notInHandbook } = parseCitations(text, sections);
          try {
            await db.insert(chatMessages).values({
              id: dbId,
              userId,
              bookId: book?.id ?? null,
              question,
              answer,
              citations,
              provider: active.provider,
              model: active.modelId,
              latencyMs: Date.now() - startedAt,
              inputTokens: usage.inputTokens ?? null,
              outputTokens: usage.outputTokens ?? null,
              cachedTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
              notInHandbook,
            });
          } finally {
            writer.write({ type: "data-citations", data: { dbId, citations, notInHandbook } });
          }
        },
      });
      writer.merge(result.toUIMessageStream<AssistantUIMessage>());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
