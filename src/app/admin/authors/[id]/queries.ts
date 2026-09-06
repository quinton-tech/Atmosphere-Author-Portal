import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, books, notes } from "@/db/schema";

/** Admin-only: the raw book row (fields BookSummary/BookDetail intentionally omit, e.g. driveFolderId). */
export async function getBookRowForAuthor(userId: string, bookId: string) {
  const [row] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Admin-only: every note on a book, visible or internal. Author-facing data/books.ts only returns visible ones. */
export async function listNotesForBook(bookId: string) {
  return db.select().from(notes).where(eq(notes.bookId, bookId)).orderBy(desc(notes.createdAt)).limit(50);
}

/** The raw admin override for a book's wp-admin edit URL, if one has been set (see actions.ts). */
export async function getWebsiteEditOverride(bookId: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "websiteEditOverrides")).limit(1);
  const map = (row?.value as Record<string, string> | undefined) ?? {};
  return map[bookId] ?? null;
}
