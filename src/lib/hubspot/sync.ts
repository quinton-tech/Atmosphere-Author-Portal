import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, bookCache, books, stageConfig, stageMilestones, syncRuns, users, type StageConfig } from "@/db/schema";
import { resolveInternalNames, type PropertyMap } from "./properties";
import { getHubSpotReader, type HubSpotReader } from "./client";
import { fetchAndPlanPage, planSync, type SyncPlan } from "./plan";

export type { PlannedBook, PlannedCache, PlannedUser, SyncPlan } from "./plan";
export { fetchAndPlanPage, planSync } from "./plan";

// ---------------------------------------------------------------------------
// app_settings helpers
// ---------------------------------------------------------------------------

async function getAppSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row ? (row.value as T) : null;
}

async function setAppSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

async function deleteAppSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

async function mergeEnumValuesSeen(delta: Record<string, string[]>): Promise<void> {
  if (Object.keys(delta).length === 0) return;
  const existing = (await getAppSetting<Record<string, string[]>>("enumValuesSeen")) ?? {};
  const merged: Record<string, string[]> = { ...existing };
  for (const [id, values] of Object.entries(delta)) {
    merged[id] = [...new Set([...(merged[id] ?? []), ...values])];
  }
  await setAppSetting("enumValuesSeen", merged);
}

// ---------------------------------------------------------------------------
// DB apply step: turns a SyncPlan into batched upserts. ≤500 rows per statement per the scale note
// in CLAUDE.md; a full-sync page is 100 projects so this is mostly a safety cap.
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function applyPlan(plan: SyncPlan): Promise<{ usersUpserted: number; booksUpserted: number }> {
  if (plan.users.length === 0) return { usersUpserted: 0, booksUpserted: 0 };

  const userIdByEmail = new Map<string, string>();
  for (const batch of chunk(plan.users, 500)) {
    const rows = await db
      .insert(users)
      .values(batch.map((u) => ({ email: u.email, name: u.name, hubspotContactId: u.hubspotContactId, role: "author" as const })))
      .onConflictDoUpdate({
        target: users.email,
        set: { name: sqlExcluded("name"), hubspotContactId: sqlExcluded("hubspot_contact_id"), updatedAt: new Date() },
      })
      .returning({ id: users.id, email: users.email });
    for (const r of rows) userIdByEmail.set(r.email, r.id);
  }

  const bookIdByProjectId = new Map<string, string>();
  for (const batch of chunk(plan.books, 500)) {
    const values = batch
      .map((b) => ({ hubspotProjectId: b.hubspotProjectId, title: b.title, userId: userIdByEmail.get(b.authorEmail) }))
      .filter((v): v is { hubspotProjectId: string; title: string; userId: string } => !!v.userId);
    if (values.length === 0) continue;
    const rows = await db
      .insert(books)
      .values(values)
      .onConflictDoUpdate({
        target: books.hubspotProjectId,
        set: { title: sqlExcluded("title"), userId: sqlExcluded("user_id"), updatedAt: new Date() },
      })
      .returning({ id: books.id, hubspotProjectId: books.hubspotProjectId });
    for (const r of rows) bookIdByProjectId.set(r.hubspotProjectId, r.id);
  }

  for (const batch of chunk(plan.caches, 500)) {
    const values = batch
      .map((c) => {
        const bookId = bookIdByProjectId.get(c.hubspotProjectId);
        return bookId ? { bookId, properties: c.properties, stageKey: c.stageKey, hubspotUpdatedAt: c.hubspotUpdatedAt, syncedAt: new Date() } : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (values.length === 0) continue;
    await db
      .insert(bookCache)
      .values(values)
      .onConflictDoUpdate({
        target: bookCache.bookId,
        set: {
          properties: sqlExcluded("properties"),
          stageKey: sqlExcluded("stage_key"),
          hubspotUpdatedAt: sqlExcluded("hubspot_updated_at"),
          syncedAt: new Date(),
        },
      });
  }

  return { usersUpserted: userIdByEmail.size, booksUpserted: bookIdByProjectId.size };
}

// drizzle-orm's `sql` helper for referencing the EXCLUDED pseudo-table in ON CONFLICT DO UPDATE.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

// ---------------------------------------------------------------------------
// Config loading shared by every sync entry point.
// ---------------------------------------------------------------------------

/** Compact schema summary cached for the admin milestone property picker. */
type ProjectSchemaEntry = { name: string; label: string; type: string; options: string[] };

async function loadSyncConfig(reader: HubSpotReader): Promise<{
  stages: Pick<StageConfig, "key" | "hubspotValues" | "kind">[];
  propertyMap: PropertyMap;
  titleProperty: string;
  unresolved: string[];
  owners: Map<string, string>;
  extraProperties: string[];
}> {
  const [schema, stageRows, propertyMapSetting, titlePropertySetting, owners, milestoneRows] = await Promise.all([
    reader.getProjectSchema(),
    // `kind` lets resolveStageKey ignore "derived" rows (no HubSpot mapping of their own) below.
    db.select({ key: stageConfig.key, hubspotValues: stageConfig.hubspotValues, kind: stageConfig.kind }).from(stageConfig),
    getAppSetting<PropertyMap>("propertyMap"),
    getAppSetting<string>("titleProperty"),
    // Owner names are optional: without the owners.read scope the team shows ids and Health flags it.
    reader.getOwners().then(
      async (m) => {
        await setAppSetting("ownersUnavailable", false);
        return m;
      },
      async (err: unknown) => {
        await setAppSetting("ownersUnavailable", err instanceof Error ? err.message.slice(0, 200) : true);
        return new Map<string, string>();
      },
    ),
    db
      .select({
        propertyName: stageMilestones.propertyName,
        linkProperty: stageMilestones.linkProperty,
        dateProperty: stageMilestones.dateProperty,
        venueProperty: stageMilestones.venueProperty,
        includeRule: stageMilestones.includeRule,
      })
      .from(stageMilestones)
      .where(eq(stageMilestones.enabled, true)),
  ]);
  const { map, unresolved } = resolveInternalNames(schema.properties, propertyMapSetting ?? {});

  // HubSpot records when a Project entered each pipeline stage ("Date entered \"Editorial (…)\""),
  // which gives the author timeline a real date per phase. The property name embeds the stage id.
  const stageEnteredProps = schema.properties.filter((p) => /^hs_v2_date_entered_/.test(p.name)).map((p) => p.name);
  const extraProperties = [
    ...new Set([
      ...milestoneRows.flatMap((m) => [m.propertyName, m.linkProperty, m.dateProperty, m.venueProperty, m.includeRule?.property?.name]).filter(
        (v): v is string => !!v,
      ),
      ...stageEnteredProps,
    ]),
  ];

  const schemaSummary: ProjectSchemaEntry[] = schema.properties.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    options: (p.options ?? []).slice(0, 40).map((o) => o.value),
  }));
  await setAppSetting("projectSchema", schemaSummary);

  return { stages: stageRows, propertyMap: map, titleProperty: titlePropertySetting ?? "name", unresolved, owners, extraProperties };
}

// ---------------------------------------------------------------------------
// Incremental / full sync — resumable across cron re-invocations.
//
// The brief asks for the pagination cursor to live on the `sync_runs` row, but that table (frozen
// schema, not editable here) has no text column for a HubSpot page token — only a `cursorUpdatedAt`
// timestamp used for the *next run's* `since`. So the in-progress page cursor is persisted instead
// in `app_settings` under a per-kind key and cleared once the run completes. See the report for the
// suggested schema follow-up (a `cursorAfter text` column on sync_runs would be the tidier fix).
// ---------------------------------------------------------------------------

type ResumeState = { syncRunId: string; after?: string; sinceIso: string | null; runStartedAtIso: string };

function resumeKey(kind: "incremental" | "full"): string {
  return `hubspot:${kind}SyncCursor`;
}

async function computeIncrementalSince(): Promise<Date | null> {
  const [last] = await db
    .select({ cursorUpdatedAt: syncRuns.cursorUpdatedAt })
    .from(syncRuns)
    .where(eq(syncRuns.status, "ok"))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (!last?.cursorUpdatedAt) return null; // no successful run yet: behave like a full sync once.
  return new Date(last.cursorUpdatedAt.getTime() - 5 * 60 * 1000); // 5 minute overlap
}

export type SyncRunResult = { syncRunId: string; done: boolean; processed: number; created: number; updated: number; unmatched: number };

const DEFAULT_MAX_DURATION_MS = 240_000; // leaves headroom under Vercel's 300s function cap

async function runPagedSync(kind: "incremental" | "full", opts: { maxDurationMs?: number } = {}): Promise<SyncRunResult> {
  const reader = getHubSpotReader();
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const budgetStart = Date.now();
  const key = resumeKey(kind);

  const resumeState = await getAppSetting<ResumeState>(key);

  let syncRunId: string;
  let since: Date | null;
  let after: string | undefined;
  let runStartedAt: Date;
  let processed = 0;
  let created = 0;
  let updated = 0;
  let unmatched = 0;

  if (resumeState) {
    syncRunId = resumeState.syncRunId;
    since = resumeState.sinceIso ? new Date(resumeState.sinceIso) : null;
    after = resumeState.after;
    runStartedAt = new Date(resumeState.runStartedAtIso);
    const [existing] = await db.select().from(syncRuns).where(eq(syncRuns.id, syncRunId)).limit(1);
    processed = existing?.processed ?? 0;
    created = existing?.created ?? 0;
    updated = existing?.updated ?? 0;
    unmatched = existing?.unmatched ?? 0;
    await db.update(syncRuns).set({ status: "running" }).where(eq(syncRuns.id, syncRunId));
  } else {
    runStartedAt = new Date();
    since = kind === "incremental" ? await computeIncrementalSince() : null;
    const [row] = await db.insert(syncRuns).values({ kind, status: "running", startedAt: runStartedAt }).returning();
    syncRunId = row.id;
    after = undefined;
  }

  const { stages, propertyMap, titleProperty, unresolved, owners, extraProperties } = await loadSyncConfig(reader);
  const enumValuesSeenAcc: Record<string, string[]> = {};
  let done = false;
  const errors: string[] = [];

  try {
    for (;;) {
      if (Date.now() - budgetStart > maxDurationMs) break;
      const { plan, nextAfter } = await fetchAndPlanPage(reader, since, after, { stages, propertyMap, titleProperty, owners, extraProperties });
      const applied = await applyPlan(plan);
      processed += plan.books.length + plan.unmatchedProjectIds.length;
      created += applied.usersUpserted;
      updated += applied.booksUpserted;
      unmatched += plan.unmatchedProjectIds.length;
      for (const [id, values] of Object.entries(plan.enumValuesSeen)) {
        enumValuesSeenAcc[id] = [...new Set([...(enumValuesSeenAcc[id] ?? []), ...values])];
      }
      after = nextAfter;
      if (!after) {
        done = true;
        break;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  await mergeEnumValuesSeen(enumValuesSeenAcc);
  await setAppSetting("propertyUnresolved", unresolved);

  const status = errors.length > 0 ? "error" : done ? "ok" : "running";
  await db
    .update(syncRuns)
    .set({
      status,
      processed,
      created,
      updated,
      unmatched,
      errors,
      finishedAt: status === "running" ? null : new Date(),
      cursorUpdatedAt: status === "ok" ? runStartedAt : undefined,
    })
    .where(eq(syncRuns.id, syncRunId));

  if (done || errors.length > 0) {
    // A hard error still clears the resume cursor: the next scheduled invocation starts a fresh
    // run rather than looping forever against whatever page caused the failure.
    await deleteAppSetting(key);
  } else {
    await setAppSetting(key, { syncRunId, after, sinceIso: since?.toISOString() ?? null, runStartedAtIso: runStartedAt.toISOString() } satisfies ResumeState);
  }

  return { syncRunId, done, processed, created, updated, unmatched };
}

export async function runIncrementalSync(): Promise<SyncRunResult> {
  return runPagedSync("incremental");
}

export async function runFullSync(): Promise<SyncRunResult> {
  return runPagedSync("full");
}

// ---------------------------------------------------------------------------
// Single-project / single-author sync for the admin "Refresh from HubSpot" action.
// ---------------------------------------------------------------------------

export async function syncSingleProject(hubspotProjectId: string): Promise<{ ok: boolean; error?: string }> {
  const reader = getHubSpotReader();
  const project = await reader.getProject(hubspotProjectId);
  if (!project) return { ok: false, error: "This project could not be found in HubSpot." };

  const { stages, propertyMap, titleProperty, owners, extraProperties } = await loadSyncConfig(reader);
  const contacts = await reader.getContactsByIds(project.contactIds);
  const plan = planSync([project], contacts, stages, propertyMap, { titleProperty, owners, extraProperties });
  await applyPlan(plan);
  await db.insert(syncRuns).values({
    kind: "single",
    status: "ok",
    finishedAt: new Date(),
    processed: 1,
    updated: plan.books.length,
    unmatched: plan.unmatchedProjectIds.length,
  });
  return { ok: true };
}

export async function syncAuthor(userId: string): Promise<{ ok: boolean; processed: number; errors: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.hubspotContactId) return { ok: false, processed: 0, errors: ["This author isn't linked to a HubSpot contact."] };

  const reader = getHubSpotReader();
  const projects = await reader.getProjectsForContact(user.hubspotContactId);
  if (projects.length === 0) return { ok: true, processed: 0, errors: [] };

  const { stages, propertyMap, titleProperty, owners, extraProperties } = await loadSyncConfig(reader);
  const contactIds = [...new Set(projects.flatMap((p) => p.contactIds))];
  const contacts = await reader.getContactsByIds(contactIds);
  const plan = planSync(projects, contacts, stages, propertyMap, { titleProperty, owners, extraProperties });
  await applyPlan(plan);
  await db.insert(syncRuns).values({
    kind: "single",
    status: "ok",
    finishedAt: new Date(),
    processed: projects.length,
    updated: plan.books.length,
    unmatched: plan.unmatchedProjectIds.length,
  });
  return { ok: true, processed: projects.length, errors: [] };
}

// Re-export so callers only need "./sync" for the whole surface admin/CLI code touches.
export type { HubSpotProject, HubSpotReader } from "./client";
export { getHubSpotReader } from "./client";
