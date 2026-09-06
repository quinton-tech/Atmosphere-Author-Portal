import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, bookCache, books, propertyDisplay, stageConfig, stageMilestones, users } from "@/db/schema";
import { evaluateMilestones } from "@/lib/hubspot/milestones";
import type { DisplayLabels } from "@/lib/hubspot/timeline";

export type ProjectSchemaEntry = { name: string; label: string; type: string; options: string[] };

export async function listMilestones() {
  return db.select().from(stageMilestones).orderBy(asc(stageMilestones.sortOrder));
}

export async function listStagesForSelect() {
  return db
    .select({ key: stageConfig.key, label: stageConfig.label, sortOrder: stageConfig.sortOrder })
    .from(stageConfig)
    .orderBy(asc(stageConfig.sortOrder));
}

/** Cached by loadSyncConfig() at sync time — see src/lib/hubspot/sync.ts. Empty until the first sync. */
export async function getProjectSchema(): Promise<ProjectSchemaEntry[]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "projectSchema")).limit(1);
  return (row?.value as ProjectSchemaEntry[] | undefined) ?? [];
}

async function loadDisplayLabels(): Promise<DisplayLabels> {
  const rows = await db.select().from(propertyDisplay);
  const out: DisplayLabels = {};
  for (const r of rows) (out[r.propertyId] ??= {})[r.rawValue] = r.label;
  return out;
}

/** Evaluate all enabled milestones against an author's most recently synced book, for the preview panel. */
export async function previewMilestonesForEmail(email: string) {
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

  const [milestones, stages, labels] = await Promise.all([
    db.select().from(stageMilestones).where(eq(stageMilestones.enabled, true)).orderBy(asc(stageMilestones.sortOrder)),
    listStagesForSelect(),
    loadDisplayLabels(),
  ]);
  const views = evaluateMilestones(row.cache?.properties ?? {}, milestones, stages, labels);
  return { bookTitle: row.book.title, milestones: views };
}
