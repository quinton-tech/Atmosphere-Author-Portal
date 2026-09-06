import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules, appSettings, bookCache, books, notes, propertyDisplay, stageConfig, stageMilestones, visibleFiles } from "@/db/schema";
import type { AuthorInfo, BookDetail, BookSummary, StageView, TimelineEvent, WebsiteView } from "@/lib/types";
import { computeDerivedStages } from "@/lib/hubspot/derived-stages";
import { evaluateActionRules } from "@/lib/hubspot/rules";
import { evaluateMilestones } from "@/lib/hubspot/milestones";
import { resolveStageKey } from "@/lib/hubspot/stages";
import { buildTeam, buildTimeline, cleanTeaser, friendly, parseDate, type DisplayLabels } from "@/lib/hubspot/timeline";

const BLUEHOST_HOSTING_URL = "https://my.bluehost.com";

/** Author website "AW Production Status" -> author-facing status line. Unlisted/future values fall back to friendly(). */
const WEBSITE_STATUS_COPY: Record<string, string> = {
  Building: "Your site is being built",
  "Initial Review Sent": "Ready for your review",
  "Sent to Author additional time": "Ready for your review",
  "Author Review": "Ready for your review",
  Maintaining: "Live and maintained",
  Expired: "Domain expired",
};

function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** `<origin-of-url>/wp-admin/`, or null if `url` isn't a parseable absolute URL. */
function deriveWpAdminUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL("/wp-admin/", url).toString();
  } catch {
    return null;
  }
}

async function loadWebsiteEditOverrides(): Promise<Record<string, string>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "websiteEditOverrides")).limit(1);
  return (row?.value as Record<string, string> | undefined) ?? {};
}

function buildWebsite(
  bookId: string,
  props: Record<string, string | null>,
  overrides: Record<string, string>,
  labels: DisplayLabels,
): WebsiteView | null {
  if (!props.websiteUrl && !props.websiteDomain && !props.websiteStatus) return null;
  const url = normalizeWebsiteUrl(props.websiteUrl);
  const rawStatus = props.websiteStatus?.trim() ?? null;
  return {
    url,
    editUrl: overrides[bookId] ?? deriveWpAdminUrl(url),
    hostingUrl: BLUEHOST_HOSTING_URL,
    status: (rawStatus && WEBSITE_STATUS_COPY[rawStatus]) || friendly("websiteStatus", props.websiteStatus, labels),
    packageName: friendly("websitePackage", props.websitePackage, labels),
    domainExpiry: parseDate(props.websiteDomainExpiry)?.toISOString() ?? null,
  };
}

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

  const [stages, rules, files, noteRows, labels, milestoneRows, websiteOverrides] = await Promise.all([
    db.select().from(stageConfig).orderBy(asc(stageConfig.sortOrder)),
    db.select().from(actionRules).where(eq(actionRules.enabled, true)).orderBy(asc(actionRules.sortOrder)),
    db.select().from(visibleFiles).where(eq(visibleFiles.bookId, book.id)).orderBy(asc(visibleFiles.sortOrder)),
    db
      .select()
      .from(notes)
      .where(and(eq(notes.bookId, book.id), eq(notes.visibleToAuthor, true)))
      .orderBy(desc(notes.createdAt)),
    loadDisplayLabels(),
    db.select().from(stageMilestones).where(eq(stageMilestones.enabled, true)).orderBy(asc(stageMilestones.sortOrder)),
    loadWebsiteEditOverrides(),
  ]);

  const props = cache?.properties ?? {};
  const pipelineRows = stages.filter((s) => s.kind !== "derived");
  const derivedRows = stages.filter((s) => s.kind === "derived");

  const currentKey = cache?.stageKey ?? resolveStageKey(props, stages);
  const pipelineIdx = pipelineRows.findIndex((s) => s.key === currentKey);
  const pipelineViews: StageView[] = pipelineRows.map((s, i) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    sortOrder: s.sortOrder,
    typicalWeeks: s.typicalWeeks,
    isTerminal: s.isTerminal,
    kind: "pipeline",
    isDerived: false,
    state: pipelineIdx === -1 ? "upcoming" : i < pipelineIdx ? "done" : i === pipelineIdx ? "current" : "upcoming",
  }));
  const currentStage = pipelineViews.find((s) => s.state === "current") ?? null;

  const now = new Date();
  const milestones = evaluateMilestones(props, milestoneRows, stages, labels, now);
  const milestoneEvents: TimelineEvent[] = milestones
    .filter((m) => m.at && (m.state === "done" || m.state === "scheduled"))
    .map((m) => ({
      id: `milestone-${m.id}`,
      at: m.at!,
      title: m.label,
      detail: m.detail,
      kind: "milestone",
      isFuture: m.state === "scheduled",
    }));

  const derivedViews = computeDerivedStages(
    derivedRows.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      sortOrder: s.sortOrder,
      parentStageKey: s.parentStageKey,
      showWhenEmpty: s.showWhenEmpty,
      milestoneIds: s.derivedMilestoneIds,
    })),
    milestones,
    pipelineViews,
  );
  const stageViews = [...pipelineViews, ...derivedViews].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: book.id,
    title: book.title,
    stageKey: currentKey,
    stageLabel: currentStage?.label ?? friendly("pipelineStage", props.pipelineStage, labels) ?? "In production",
    isArchived: !!book.archivedAt,
    updatedAt: (cache?.hubspotUpdatedAt ?? book.updatedAt).toISOString(),
    stages: stageViews,
    currentStage,
    timeline: buildTimeline(props, stages, currentKey, labels, now, milestoneEvents),
    team: buildTeam(props, labels),
    milestones,
    website: buildWebsite(book.id, props, websiteOverrides, labels),
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
