import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules, bookCache, books, users } from "@/db/schema";
import { evaluateActionRules } from "@/lib/hubspot/rules";

export async function listRules() {
  return db.select().from(actionRules).orderBy(asc(actionRules.sortOrder));
}

/** Evaluate all enabled rules against an author's most recently synced book, for the preview panel. */
export async function previewRulesForEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user) return { error: "No author with that email." as const };

  const [row] = await db
    .select({ book: books, cache: bookCache })
    .from(books)
    .leftJoin(bookCache, eq(bookCache.bookId, books.id))
    .where(eq(books.userId, user.id))
    .orderBy(desc(books.updatedAt))
    .limit(1);
  if (!row) return { error: "This author has no synced books." as const };

  const rules = await db.select().from(actionRules).where(eq(actionRules.enabled, true)).orderBy(asc(actionRules.sortOrder));
  const actions = evaluateActionRules(row.cache?.properties ?? {}, rules);
  return { bookTitle: row.book.title, actions };
}
