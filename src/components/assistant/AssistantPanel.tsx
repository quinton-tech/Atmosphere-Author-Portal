"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { cn } from "@/components/cn";
import { stripSourcesLine, type AssistantDataParts, type CitationsDataPart } from "@/lib/assistant/citations";

export type AssistantPanelProps = {
  /** Scopes the question to one of the signed-in author's books (ownership re-checked server-side). */
  bookId: string;
  /** Shown as clickable starter chips before the author has asked anything. */
  suggestedQuestions?: string[];
  className?: string;
};

type AssistantUIMessage = UIMessage<unknown, AssistantDataParts>;

/** `useChat` resends the whole conversation on every turn; without a cap a long-running chat (the
 *  reported failure was a 26th question) would eventually exceed the route's message-count limit.
 *  Kept in sync with `RECENT_UI_MESSAGES` in `src/app/api/chat/route.ts`, which re-applies the same
 *  slice server-side as defense in depth. */
const HISTORY_LIMIT = 20;

function messageText(message: AssistantUIMessage): string {
  return message.parts
    .filter((p): p is Extract<AssistantUIMessage["parts"][number], { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function messageCitations(message: AssistantUIMessage): CitationsDataPart | null {
  const part = message.parts.find((p) => p.type === "data-citations");
  return part && part.type === "data-citations" ? part.data : null;
}

/**
 * The route always responds with `{ error: string }` on a 4xx (rate limit, bad request, assistant
 * not configured, …); `HttpChatTransport` throws `new Error(await response.text())` on any non-ok
 * response, so `error.message` is that raw JSON text. Surface the server's actual copy instead of
 * a generic fallback whenever it parses; only truly unexpected failures (network errors, a non-JSON
 * body) fall back to a generic message.
 */
function errorMessage(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const body: unknown = JSON.parse(error.message);
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return "Something went wrong. Please try again.";
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" style={down ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M7 9v8H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h3Zm0 0 3.6-6.2a1.5 1.5 0 0 1 2.7.6l-.5 4.1H16a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 15 17H9.5a2 2 0 0 1-1.4-.6L7 15.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AssistantPanel({ bookId, suggestedQuestions = [], className }: AssistantPanelProps) {
  const [input, setInput] = useState("");
  const [rated, setRated] = useState<Record<string, 1 | -1>>({});

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { bookId },
        // Trim client-side before the request is even built, so a long-running conversation never
        // grows the payload past what the route needs (it re-slices to the same 20 server-side).
        prepareSendMessagesRequest: ({ id, messages: allMessages, trigger, messageId, body }) => ({
          body: { ...body, id, trigger, messageId, messages: allMessages.slice(-HISTORY_LIMIT) },
        }),
      }),
    [bookId],
  );
  const { messages, sendMessage, status, error, setMessages, clearError } = useChat<AssistantUIMessage>({ transport });

  const busy = status === "submitted" || status === "streaming";

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  function startNewConversation() {
    setMessages([]);
    clearError();
    setRated({});
    setInput("");
  }

  async function rate(messageId: string, dbId: string, value: 1 | -1) {
    setRated((r) => ({ ...r, [messageId]: value }));
    try {
      await fetch("/api/chat/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: dbId, rating: value }),
      });
    } catch {
      // Best-effort — a failed rating shouldn't interrupt the conversation.
    }
  }

  return (
    <aside className={cn("rounded-2xl border border-line bg-surface p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="eyebrow">Ask the Author Handbook</h2>
          <p className="mt-2 max-w-[72ch] text-ink-2">
            Answers are grounded in the Author Handbook. For anything specific to your book — dates, money, contract terms — ask your main
            contact.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={startNewConversation}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-2 hover:text-ink"
          >
            Start a new conversation
          </button>
        )}
      </div>

      {messages.length === 0 && suggestedQuestions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {suggestedQuestions.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => ask(q)}
                className="rounded-full border border-line px-4 py-2 text-left text-sm text-ink-2 transition-colors hover:border-teal hover:text-teal-ink"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}

      {messages.length > 0 && (
        <div className="mt-6 flex flex-col gap-6">
          {messages.map((m) => {
            if (m.role !== "user" && m.role !== "assistant") return null;
            const text = messageText(m);

            if (m.role === "user") {
              return (
                <div key={m.id} className="border-l-2 border-line pl-4">
                  <div className="eyebrow">You</div>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{text}</p>
                </div>
              );
            }

            const citationsPart = messageCitations(m);
            const displayText = stripSourcesLine(text).text;
            const myRating = rated[m.id];

            return (
              <div key={m.id} className="border-l-2 border-teal pl-4">
                <div className="eyebrow text-teal-ink">Assistant</div>
                <p className="mt-1 whitespace-pre-wrap text-ink">{displayText || (busy ? "…" : "")}</p>

                {citationsPart && citationsPart.citations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {citationsPart.citations.map((c) => (
                      <details
                        key={c.sectionId}
                        className="max-w-full rounded-2xl border border-line px-3 py-1.5 text-xs text-muted open:bg-bg"
                      >
                        <summary className="cursor-pointer list-none font-medium text-ink-2">
                          From: {c.sectionId} {c.heading}
                        </summary>
                        {c.quote && <p className="mt-2 max-w-[60ch] text-ink-2">{c.quote}</p>}
                      </details>
                    ))}
                  </div>
                )}

                {citationsPart?.notInHandbook && (
                  <p className="mt-2 text-xs text-muted">Not covered in the Author Handbook.</p>
                )}

                {citationsPart && status === "ready" && (
                  <div className="mt-3 flex items-center gap-1 text-muted">
                    <span className="eyebrow mr-1">Helpful?</span>
                    <button
                      type="button"
                      aria-label="Helpful"
                      aria-pressed={myRating === 1}
                      onClick={() => rate(m.id, citationsPart.dbId, 1)}
                      className={cn(
                        "rounded-full border border-line p-1.5 transition-colors hover:border-teal hover:text-teal-ink",
                        myRating === 1 && "border-teal text-teal-ink",
                      )}
                    >
                      <ThumbIcon />
                    </button>
                    <button
                      type="button"
                      aria-label="Not helpful"
                      aria-pressed={myRating === -1}
                      onClick={() => rate(m.id, citationsPart.dbId, -1)}
                      className={cn(
                        "rounded-full border border-line p-1.5 transition-colors hover:border-coral hover:text-coral-ink",
                        myRating === -1 && "border-coral text-coral-ink",
                      )}
                    >
                      <ThumbIcon down />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-bad">{errorMessage(error)}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="mt-6 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about the process…"
          disabled={busy}
          className="flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </aside>
  );
}
