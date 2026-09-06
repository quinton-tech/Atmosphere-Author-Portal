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

export type PreviewBookOption = { id: string; title: string };

async function listAuthorBooksForPreview(userId: string): Promise<PreviewBookOption[]> {
  return db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(desc(books.updatedAt));
}

export type MilestonePreviewDetail = {
  milestoneId: string;
  label: string;
  stageLabel: string;
  propertyName: string;
  available: boolean;
  value: string | null;
  wouldShow: boolean;
  state?: MilestoneRuntimeState;
  detail: string | null;
};

type MilestoneRuntimeState = "done" | "in_progress" | "scheduled" | "pending";

/** Evaluate all enabled milestones against one of an author's books (defaulting to their most
 *  recently synced one), for the preview panel — both the milestones that would actually show
 *  (via evaluateMilestones, unchanged), and a full per-milestone breakdown of the cached property
 *  value behind that, including milestones that wouldn't show, so staff can tell "excluded" from
 *  "would show but nothing's happened yet" from "HubSpot hasn't sent us a value yet". */
export async function previewMilestonesForBook(email: string, bookId?: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user) return { error: "No author with that email." as const };

  const bookOptions = await listAuthorBooksForPreview(user.id);
  if (bookOptions.length === 0) return { error: "This author has no synced books." as const };

  const selected = bookOptions.find((b) => b.id === bookId) ?? bookOptions[0];
  const [cacheRow] = await db.select({ properties: bookCache.properties }).from(bookCache).where(eq(bookCache.bookId, selected.id)).limit(1);
  const props = cacheRow?.properties ?? {};

  const [milestoneRows, stages, labels] = await Promise.all([
    db.select().from(stageMilestones).where(eq(stageMilestones.enabled, true)).orderBy(asc(stageMilestones.sortOrder)),
    listStagesForSelect(),
    loadDisplayLabels(),
  ]);
  const stageLabelByKey = new Map(stages.map((s) => [s.key, s.label]));
  const views = evaluateMilestones(props, milestoneRows, stages, labels);
  const viewById = new Map(views.map((v) => [v.id, v]));

  const details: MilestonePreviewDetail[] = milestoneRows.map((m) => {
    const key = `hs:${m.propertyName}`;
    const view = viewById.get(m.id);
    return {
      milestoneId: m.id,
      label: m.label,
      stageLabel: stageLabelByKey.get(m.stageKey) ?? m.stageKey,
      propertyName: m.propertyName,
      available: key in props,
      value: props[key] ?? null,
      wouldShow: !!view,
      state: view?.state,
      detail: view?.detail ?? null,
    };
  });

  return { books: bookOptions, bookId: selected.id, bookTitle: selected.title, milestones: views, details };
}
