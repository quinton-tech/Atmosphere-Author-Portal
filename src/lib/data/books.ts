import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules, appSettings, bookCache, books, notes, propertyDisplay, stageConfig, stageMilestones, visibleFiles } from "@/db/schema";
import type {
  AuthorInfo,
  BookDetail,
  BookSummary,
  MilestoneView,
  NextUpdate,
  PhaseView,
  PrimaryContact,
  StageView,
  TimelineEvent,
  WebsiteView,
} from "@/lib/types";
import { computeDerivedStages } from "@/lib/hubspot/derived-stages";
import { evaluateActionRules } from "@/lib/hubspot/rules";
import { evaluateMilestones } from "@/lib/hubspot/milestones";
import { TEAM_ROLES } from "@/lib/hubspot/properties";
import { resolveStageKey } from "@/lib/hubspot/stages";
import { buildTeam, buildTimeline, cleanTeaser, displayPersonName, friendly, parseDate, type DisplayLabels } from "@/lib/hubspot/timeline";
import { getTeamDirectory } from "@/lib/data/team";
import { nameKey } from "@/lib/team/parse";

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

type PrimaryContactSetting = { roleKey: string; handles: string };

const DEFAULT_PRIMARY_CONTACT_SETTING: PrimaryContactSetting = {
  roleKey: "bpm",
  handles: "Your schedule, questions about where your book is, and anything you're not sure who to ask.",
};

async function loadPrimaryContactSetting(): Promise<PrimaryContactSetting> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "primaryContact")).limit(1);
  return (row?.value as PrimaryContactSetting | undefined) ?? DEFAULT_PRIMARY_CONTACT_SETTING;
}

/** app_settings.owners: name -> email, refreshed on every sync (see sync.ts loadSyncConfig). */
async function loadOwnersByName(): Promise<Record<string, string | null>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "owners")).limit(1);
  return (row?.value as Record<string, string | null> | undefined) ?? {};
}

/** The one person the author should reach out to, per app_settings.primaryContact's roleKey. */
async function buildPrimaryContact(
  props: Record<string, string | null>,
  setting: PrimaryContactSetting,
  ownersByName: Record<string, string | null>,
): Promise<PrimaryContact | null> {
  const roleDef = TEAM_ROLES.find((r) => r.person === setting.roleKey);
  if (!roleDef) return null;
  const name = displayPersonName(props[roleDef.person]);
  if (!name) return null;
  const directory = await getTeamDirectory();
  const dirEntry = directory.get(nameKey(name));
  return {
    roleKey: setting.roleKey,
    roleLabel: roleDef.role,
    name,
    email: ownersByName[name] ?? null,
    title: dirEntry?.title ?? null,
    photoUrl: dirEntry?.photoUrl ?? null,
    handles: setting.handles,
  };
}

/** Estimated next thing the author will hear about, from the current stage's typical duration. */
function buildNextUpdate(currentStage: StageView | null, now: Date): NextUpdate | null {
  if (!currentStage || currentStage.isTerminal) return null;
  if (!currentStage.typicalWeeks || !currentStage.enteredAt) return null;
  const estimate = new Date(currentStage.enteredAt);
  estimate.setUTCDate(estimate.getUTCDate() + currentStage.typicalWeeks * 7);
  if (estimate.getTime() < now.getTime()) {
    return { label: "Your team's next update is due", at: null };
  }
  return { label: "Next update expected around", at: estimate.toISOString() };
}

const DOMAIN_EXPIRY_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function buildWebsite(
  bookId: string,
  props: Record<string, string | null>,
  overrides: Record<string, string>,
  labels: DisplayLabels,
  now: Date,
): WebsiteView | null {
  if (!props.websiteUrl && !props.websiteDomain && !props.websiteStatus) return null;
  const url = normalizeWebsiteUrl(props.websiteUrl);
  const rawStatus = props.websiteStatus?.trim() ?? null;
  const domainExpiry = parseDate(props.websiteDomainExpiry);

  let domainStatus: WebsiteView["domainStatus"] = null;
  let domainExpiryDays: number | null = null;
  if (domainExpiry) {
    const diffMs = domainExpiry.getTime() - now.getTime();
    domainExpiryDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    domainStatus = diffMs <= 0 ? "past" : diffMs <= DOMAIN_EXPIRY_SOON_WINDOW_MS ? "soon" : "ok";
  }

  return {
    url,
    editUrl: overrides[bookId] ?? deriveWpAdminUrl(url),
    hostingUrl: BLUEHOST_HOSTING_URL,
    status: (rawStatus && WEBSITE_STATUS_COPY[rawStatus]) || friendly("websiteStatus", props.websiteStatus, labels),
    packageName: friendly("websitePackage", props.websitePackage, labels),
    domainExpiry: domainExpiry?.toISOString() ?? null,
    domainStatus,
    domainExpiryDays,
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

  const [stages, rules, files, noteRows, labels, milestoneRows, websiteOverrides, primaryContactSetting, ownersByName] = await Promise.all([
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
    loadPrimaryContactSetting(),
    loadOwnersByName(),
  ]);

  const props = cache?.properties ?? {};
  const pipelineRows = stages.filter((s) => s.kind !== "derived");
  const derivedRows = stages.filter((s) => s.kind === "derived");

  // HubSpot's own record-creation date, used to sanitise "date entered <stage>" values that are
  // really just "the day this record was migrated into HubSpot" (see stageEnteredAt below).
  const recordCreatedIso = parseDate(props.recordCreated)?.toISOString() ?? null;
  const initiationDateIso = parseDate(props.initiationDate)?.toISOString() ?? null;
  const publicationDateIso = parseDate(props.publicationDate)?.toISOString() ?? null;

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
    // A provisional value: buildPhases resolves the date/completion the author actually sees once
    // each phase's events and milestones are grouped (initiation/publication dates, milestone dates,
    // and assignment events all take priority over this raw HubSpot "date entered" value).
    enteredAt: stageEnteredAt(props, s.hubspotValues, recordCreatedIso),
    completion: null,
    state: pipelineIdx === -1 ? "upcoming" : i < pipelineIdx ? "done" : i === pipelineIdx ? "current" : "upcoming",
  }));

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

  // Authors see done / in-progress / scheduled milestones anywhere, but "pending" ones only for the
  // current stage: future stages would be noise, and a past stage with no recorded value is a
  // HubSpot gap, not an undone task.
  const currentStageKeys = new Set(pipelineViews.filter((s) => s.state === "current").map((s) => s.key));
  const visibleMilestones = milestones.filter((m) => m.state !== "pending" || currentStageKeys.has(m.stageKey));

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
  const phases = buildPhases(
    stageViews,
    derivedRows,
    buildTimeline(props, stages, currentKey, labels, now, []),
    visibleMilestones,
    initiationDateIso,
    publicationDateIso,
  );
  // `stages` and `phases` must agree on enteredAt/completion, so derive the former from the
  // latter (already finalized) rather than from the pre-finalization stageViews above.
  const finalizedStages: StageView[] = phases.map(({ events: _events, milestones: _milestones, ...s }) => s);
  const currentStage = finalizedStages.find((s) => s.state === "current") ?? null;

  const primaryContact = await buildPrimaryContact(props, primaryContactSetting, ownersByName);
  const filesView = files.map((f) => ({
    id: f.id,
    label: f.label,
    category: f.category,
    mimeType: f.mimeType,
    href: `/api/files/${f.id}`,
    thumbnailHref: f.mimeType?.startsWith("image/") || f.mimeType === "application/pdf" ? `/api/files/${f.id}/thumbnail` : null,
  }));
  const nextUpdate = buildNextUpdate(currentStage, now);
  const coverHref = filesView.find((f) => f.category.toLowerCase() === "cover" && f.mimeType?.startsWith("image/"))?.thumbnailHref ?? null;

  return {
    id: book.id,
    title: book.title,
    stageKey: currentKey,
    stageLabel: currentStage?.label ?? friendly("pipelineStage", props.pipelineStage, labels) ?? "In production",
    isArchived: !!book.archivedAt,
    updatedAt: (cache?.hubspotUpdatedAt ?? book.updatedAt).toISOString(),
    stages: finalizedStages,
    phases,
    currentStage,
    primaryContact,
    nextUpdate,
    coverHref,
    timeline: buildTimeline(props, stages, currentKey, labels, now, milestoneEvents),
    team: buildTeam(props, labels),
    milestones: visibleMilestones,
    website: buildWebsite(book.id, props, websiteOverrides, labels, now),
    package: friendly("package", props.package, labels),
    teaser: cleanTeaser(props.teaser),
    initiationDate: initiationDateIso,
    publicationDate: publicationDateIso,
    isPublished: Boolean(publicationDateIso && new Date(publicationDateIso).getTime() <= now.getTime()),
    filesConnected: Boolean(book.driveFolderId),
    actions: evaluateActionRules(props, rules),
    files: filesView,
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

/**
 * Default book to show: most recently updated, non-archived first — unless `preferredBookId`
 * (the `ap_book` cookie set by BookSwitcher) names one of this user's own books, in which case
 * that's returned instead so `/dashboard` reopens the book the author was last looking at.
 */
export async function defaultBookIdForUser(userId: string, preferredBookId?: string | null): Promise<string | null> {
  const list = await listBooksForUser(userId);
  if (preferredBookId && list.some((b) => b.id === preferredBookId)) return preferredBookId;
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


/** Migrated records were bulk-imported into HubSpot on one day; a "date entered <stage>" value that
 *  close to `hs_createdate` is that import, not the day the project actually reached the stage. */
const MIGRATION_ARTIFACT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function isMigrationArtifact(enteredIso: string, recordCreatedIso: string | null): boolean {
  if (!recordCreatedIso) return false;
  return Math.abs(new Date(enteredIso).getTime() - new Date(recordCreatedIso).getTime()) <= MIGRATION_ARTIFACT_WINDOW_MS;
}

/**
 * HubSpot's "Date entered <stage>" property for a pipeline stage, looked up by the stage id
 * embedded in its name. Sanitised against `recordCreatedIso`: a value within 3 days of the record's
 * HubSpot creation date is almost always "the day this project was migrated into HubSpot", not a
 * real stage-entry date, so it's discarded (null) rather than shown to the author.
 */
function stageEnteredAt(props: Record<string, string | null>, hubspotValues: string[], recordCreatedIso: string | null): string | null {
  for (const raw of hubspotValues) {
    const idPart = raw.replace(/-/g, "_");
    if (!/^[0-9a-f_]+$/i.test(idPart)) continue;
    const prefix = `hs:hs_v2_date_entered_${idPart}`;
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith(prefix) && v) {
        const d = parseDate(v);
        if (d) {
          const iso = d.toISOString();
          return isMigrationArtifact(iso, recordCreatedIso) ? null : iso;
        }
      }
    }
  }
  return null;
}

/** Which stage each dated event belongs to on the phase timeline. */
const EVENT_STAGE: Record<string, string[]> = {
  initiation: ["onboarding"],
  developmentalEditorAssigned: ["editorial", "developmental_editing"],
  proofreaderAssigned: ["proofreading"],
  coverDesignerAssigned: ["cover_design", "interior_design"],
  interiorDesignerAssigned: ["interior_design"],
};

function buildPhases(
  stageViews: StageView[],
  derivedRows: { key: string; derivedMilestoneIds: string[] }[],
  events: TimelineEvent[],
  milestones: MilestoneView[],
  initiationDate: string | null,
  publicationDate: string | null,
): PhaseView[] {
  const keys = new Set(stageViews.map((s) => s.key));
  const phases: PhaseView[] = stageViews.map((s) => ({ ...s, events: [], milestones: [] }));
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const terminal = phases.find((p) => p.isTerminal) ?? phases[phases.length - 1];

  for (const e of events) {
    if (e.kind === "current") continue; // the current phase is highlighted by its own state
    if (e.id === "publication") {
      terminal?.events.push(e);
      continue;
    }
    const target = (EVENT_STAGE[e.id] ?? []).find((k) => keys.has(k));
    if (target) byKey.get(target)!.events.push(e);
  }

  for (const m of milestones) {
    const derived = derivedRows.find((d) => d.derivedMilestoneIds.includes(m.id));
    const target = derived && keys.has(derived.key) ? derived.key : keys.has(m.stageKey) ? m.stageKey : null;
    if (target) byKey.get(target)!.milestones.push(m);
  }

  for (const p of phases) p.events.sort((a, b) => a.at.localeCompare(b.at));

  // Choose the date most meaningful to the author for each phase, and (for pipeline stages) settle
  // whether a "done" phase's date/completion is confirmed by a real record or only inferred because
  // the pipeline has moved past it. Order of preference: Onboarding's own Initiation Date; the
  // terminal stage's Publication Date; a derived phase's earliest done milestone; the earliest
  // confirmed event inside any phase; else the (already-sanitised) HubSpot stage-entered date each
  // phase started with; else null.
  for (const p of phases) {
    const sanitisedStageEntered = p.enteredAt;
    const earliestEvent = p.events[0]?.at ?? null; // events are sorted ascending above
    const earliestDoneMilestone = p.milestones
      .filter((m) => m.state === "done" && m.at)
      .map((m) => m.at!)
      .sort()[0];

    let resolvedDate: string | null;
    if (p.key === "onboarding") resolvedDate = initiationDate;
    else if (p.isTerminal) resolvedDate = publicationDate;
    else if (p.kind === "derived" && earliestDoneMilestone) resolvedDate = earliestDoneMilestone;
    else if (earliestEvent) resolvedDate = earliestEvent;
    else if (earliestDoneMilestone) resolvedDate = earliestDoneMilestone;
    else resolvedDate = sanitisedStageEntered;
    p.enteredAt = resolvedDate;

    if (p.kind === "pipeline") {
      // A pipeline phase is confirmed done when we have a real date for it or any of its milestones
      // is done (e.g. Publicity with delivered reviews); otherwise the pipeline merely moved past it.
      const hasDoneMilestone = p.milestones.some((m) => m.state === "done");
      p.completion = p.state === "done" ? (resolvedDate || hasDoneMilestone ? "confirmed" : "inferred") : null;
    }
  }

  return phases;
}
