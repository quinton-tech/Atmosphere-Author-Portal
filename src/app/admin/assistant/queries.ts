import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, books, chatMessages, users } from "@/db/schema";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

export type AssistantSettings = { provider: "anthropic" | "openai" | "google" | null; model: string | null };

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "assistant")).limit(1);
  const value = (row?.value as Partial<AssistantSettings> | undefined) ?? {};
  return { provider: value.provider ?? null, model: value.model ?? null };
}

type Cursor = { createdAt: string; id: string };

export async function listChatMessages(opts: {
  rating?: "-1" | "1";
  notInHandbook?: boolean;
  cursor?: string;
}): Promise<{ rows: (typeof chatMessages.$inferSelect & { userEmail: string })[]; nextCursor: string | null }> {
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const conds = [];
  if (opts.rating) conds.push(eq(chatMessages.rating, Number(opts.rating)));
  if (opts.notInHandbook) conds.push(eq(chatMessages.notInHandbook, true));
  if (cursor) conds.push(sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({ message: chatMessages, userEmail: users.email })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(where)
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.message.createdAt.toISOString(), id: last.message.id } satisfies Cursor) : null;

  return { rows: page.map((r) => ({ ...r.message, userEmail: r.userEmail })), nextCursor };
}

export type ChatMessageDetail = typeof chatMessages.$inferSelect & { userEmail: string; bookTitle: string | null };

/** One chat message with its author's email and book title, for `/admin/assistant/[id]`. */
export async function getChatMessageDetail(id: string): Promise<ChatMessageDetail | null> {
  const [row] = await db
    .select({ message: chatMessages, userEmail: users.email, bookTitle: books.title })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .leftJoin(books, eq(books.id, chatMessages.bookId))
    .where(eq(chatMessages.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row.message, userEmail: row.userEmail, bookTitle: row.bookTitle };
}
