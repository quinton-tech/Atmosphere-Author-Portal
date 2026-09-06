import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules, bookCache, books, users } from "@/db/schema";
import { evaluateActionRules, rulePropertyIsAvailable } from "@/lib/hubspot/rules";

export async function listRules() {
  return db.select().from(actionRules).orderBy(asc(actionRules.sortOrder));
}

export type PreviewBookOption = { id: string; title: string };

function rawValueFor(propertyName: string, props: Record<string, string | null>): string | null {
  if (propertyName in props) return props[propertyName];
  if (`hs:${propertyName}` in props) return props[`hs:${propertyName}`];
  return null;
}

async function listAuthorBooksForPreview(userId: string): Promise<PreviewBookOption[]> {
  return db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(desc(books.updatedAt));
}

export type RulePreviewDetail = {
  ruleId: string;
  title: string;
  propertyName: string;
  available: boolean;
  value: string | null;
  matched: boolean;
};

/** Evaluate all enabled rules against one of an author's books (defaulting to their most recently
 *  synced one), for the preview panel — both the action items that would show, and a full
 *  per-rule breakdown of what property value drove that (or why it couldn't be evaluated). */
export async function previewRulesForBook(email: string, bookId?: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user) return { error: "No author with that email." as const };

  const bookOptions = await listAuthorBooksForPreview(user.id);
  if (bookOptions.length === 0) return { error: "This author has no synced books." as const };

  const selected = bookOptions.find((b) => b.id === bookId) ?? bookOptions[0];
  const [cacheRow] = await db.select({ properties: bookCache.properties }).from(bookCache).where(eq(bookCache.bookId, selected.id)).limit(1);
  const props = cacheRow?.properties ?? {};

  const rules = await db.select().from(actionRules).where(eq(actionRules.enabled, true)).orderBy(asc(actionRules.sortOrder));
  const actions = evaluateActionRules(props, rules);
  const matchedIds = new Set(actions.map((a) => a.id));

  const details: RulePreviewDetail[] = rules.map((r) => ({
    ruleId: r.id,
    title: r.title,
    propertyName: r.propertyName,
    available: rulePropertyIsAvailable(r.propertyName, props),
    value: rawValueFor(r.propertyName, props),
    matched: matchedIds.has(r.id),
  }));

  return { books: bookOptions, bookId: selected.id, bookTitle: selected.title, actions, details };
}
