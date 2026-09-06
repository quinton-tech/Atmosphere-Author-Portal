import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules, bookCache, books, notes, propertyDisplay, stageConfig, visibleFiles } from "@/db/schema";
import type { AuthorInfo, BookDetail, BookSummary, StageView } from "@/lib/types";
import { evaluateActionRules } from "@/lib/hubspot/rules";
import { resolveStageKey } from "@/lib/hubspot/stages";
import { buildTeam, buildTimeline, cleanTeaser, friendly, parseDate, type DisplayLabels } from "@/lib/hubspot/timeline";

/**
 * All data access for books is scoped by userId. There is deliberately no
 * `getBookById(id)` without a userId. Admin code passes the target author's id.
 */

async function loadDisplayLabels(): Promise<DisplayLabels> {
  const rows = await db.select().from(propertyDisplay);
  const out: DisplayLabels = {};
  for (const r of rows) (out[r.propertyId] ??= {})[r.rawValue] = r.label;
  return out;
}

export async function listBooksForUser(userId: string): Promise<BookSummary[]> {
  const [stages, labels] = await Promise.all([db.select().from(stageConfig), loadDisplayLabels()]);
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const rows = await db
    .select({ book: books, cache: bookCache })
    .from(books)
    .leftJoin(bookCache, eq(bookCache.bookId, books.id))
    .where(eq(books.userId, userId))
    .orderBy(desc(books.updatedAt));
  return rows.map(({ book, cache }) => ({
    id: book.id,
    title: book.title,
    stageKey: cache?.stageKey ?? null,
    stageLabel:
      (cache?.stageKey && byKey.get(cache.stageKey)?.label) ||
      friendly("pipelineStage", cache?.properties.pipelineStage, labels) ||
      "In production",
    isArchived: !!book.archivedAt,
    updatedAt: (cache?.hubspotUpdatedAt ?? book.updatedAt).toISOString(),
  }));
}

export async function getBookForUser(
  userId: string,
  bookId: string,
  opts: { includeProperties?: boolean } = {},
): Promise<BookDetail | null> {
  const [row] = await db
    .select({ book: books, cache: bookCache })
    .from(books)
    .leftJoin(bookCache, eq(bookCache.bookId, books.id))
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
  if (!row) return null;
  const { book, cache } = row;

  const [stages, rules, files, noteRows, labels] = await Promise.all([
    db.select().from(stageConfig).orderBy(asc(stageConfig.sortOrder)),
    db.select().from(actionRules).where(eq(actionRules.enabled, true)).orderBy(asc(actionRules.sortOrder)),
    db.select().from(visibleFiles).where(eq(visibleFiles.bookId, book.id)).orderBy(asc(visibleFiles.sortOrder)),
    db
      .select()
      .from(notes)
      .where(and(eq(notes.bookId, book.id), eq(notes.visibleToAuthor, true)))
      .orderBy(desc(notes.createdAt)),
    loadDisplayLabels(),
  ]);

  const props = cache?.properties ?? {};
  const currentKey = cache?.stageKey ?? resolveStageKey(props, stages);
  const currentIdx = stages.findIndex((s) => s.key === currentKey);
  const stageViews: StageView[] = stages.map((s, i) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    sortOrder: s.sortOrder,
    typicalWeeks: s.typicalWeeks,
    isTerminal: s.isTerminal,
    state: currentIdx === -1 ? "upcoming" : i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
  }));
  const currentStage = stageViews.find((s) => s.state === "current") ?? null;

  return {
    id: book.id,
    title: book.title,
    stageKey: currentKey,
    stageLabel: currentStage?.label ?? friendly("pipelineStage", props.pipelineStage, labels) ?? "In production",
    isArchived: !!book.archivedAt,
    updatedAt: (cache?.hubspotUpdatedAt ?? book.updatedAt).toISOString(),
    stages: stageViews,
    currentStage,
    timeline: buildTimeline(props, stages, currentKey, labels),
    team: buildTeam(props, labels),
    package: friendly("package", props.package, labels),
    teaser: cleanTeaser(props.teaser),
    initiationDate: parseDate(props.initiationDate)?.toISOString() ?? null,
    publicationDate: parseDate(props.publicationDate)?.toISOString() ?? null,
    actions: evaluateActionRules(props, rules),
    files: files.map((f) => ({
      id: f.id,
      label: f.label,
      category: f.category,
      mimeType: f.mimeType,
      href: `/api/files/${f.id}`,
      thumbnailHref: f.mimeType?.startsWith("image/") || f.mimeType === "application/pdf" ? `/api/files/${f.id}/thumbnail` : null,
    })),
    notes: noteRows.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })),
    syncedAt: cache?.syncedAt?.toISOString() ?? null,
    ...(opts.includeProperties ? { properties: props } : {}),
  };
}

/** Author contact info as cached from HubSpot (taken from the most recently synced book). */
export async function getAuthorInfoForUser(userId: string): Promise<AuthorInfo | null> {
  const [row] = await db
    .select({ cache: bookCache })
    .from(books)
    .innerJoin(bookCache, eq(bookCache.bookId, books.id))
    .where(eq(books.userId, userId))
    .orderBy(desc(bookCache.syncedAt))
    .limit(1);
  if (!row) return null;
  const p = row.cache.properties;
  return {
    phone: p.phone ?? null,
    email: p.authorEmail ?? null,
    street: p.street ?? null,
    city: p.city ?? null,
    region: p.region ?? null,
    postalCode: p.postalCode ?? null,
    country: p.country ?? null,
  };
}

/** Default book to show: most recently updated, non-archived first. */
export async function defaultBookIdForUser(userId: string): Promise<string | null> {
  const list = await listBooksForUser(userId);
  return (list.find((b) => !b.isArchived) ?? list[0])?.id ?? null;
}

/** Ownership check for the file proxy. Returns the file row only if the user owns its book. */
export async function getVisibleFileForUser(userId: string, fileId: string) {
  const [row] = await db
    .select({ file: visibleFiles, book: books })
    .from(visibleFiles)
    .innerJoin(books, eq(books.id, visibleFiles.bookId))
    .where(and(eq(visibleFiles.id, fileId), eq(books.userId, userId)))
    .limit(1);
  return row ?? null;
}
