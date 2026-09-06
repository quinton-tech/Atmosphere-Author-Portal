import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, books, notes, visibleFiles, type VisibleFile } from "@/db/schema";

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

/**
 * Admin-only: the raw `visible_files` override rows across every one of this author's books,
 * keyed `"<bookId>:<driveFileId>"`. `visible_files` is an *overrides* table now (see
 * CLAUDE.md) — a Drive file with no row here just shows with its own name/inferred category,
 * `hidden` false. DrivePanel uses this to pre-fill the hide toggle and label/category override
 * inputs with what's actually stored, as opposed to `getAuthorFiles`' already-merged/effective
 * label and category.
 */
export async function listFileOverridesForAuthor(bookIds: string[]): Promise<Map<string, VisibleFile>> {
  if (bookIds.length === 0) return new Map();
  const rows = await db.select().from(visibleFiles).where(inArray(visibleFiles.bookId, bookIds));
  return new Map(rows.map((r) => [`${r.bookId}:${r.driveFileId}`, r]));
}
