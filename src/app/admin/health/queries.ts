import "server-only";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, auditLog, books, handbookVersions, syncRuns, users } from "@/db/schema";
import { configuredProviders } from "@/lib/env";
import { listUnmappedStageValues } from "../stages/queries";

export async function listRecentSyncRuns() {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(20);
}

export async function getActiveHandbook() {
  const [row] = await db.select().from(handbookVersions).where(eq(handbookVersions.isActive, true)).limit(1);
  return row ?? null;
}

/** The active handbook is still the seeded demo sample, not the real Author Handbook. */
export function isDemoHandbook(handbook: { filename: string; sections: unknown[] } | null): boolean {
  if (!handbook) return false;
  return handbook.filename.toLowerCase().startsWith("demo-") || handbook.sections.length < 20;
}

export type SyncRunRow = typeof syncRuns.$inferSelect;

/**
 * `sync_runs` has no column recording who/what triggered a run, so "automatic" (cron) vs "manual"
 * (the buttons on this page) is inferred from `audit_log`: the "Run incremental/full sync" buttons
 * write `admin.sync.trigger` with targetType "sync_run" (the separate per-author "Refresh from
 * HubSpot" action on an author's page uses targetType "user" and is ignored here — it also writes
 * a `sync_runs` row, but kind "single", already excluded by the `kind` filter below). A sync_runs
 * row is treated as manual if it started within 60s of one of those audit rows — approximate, but
 * good enough to label a run "probably cron" vs "you just clicked the button".
 */
export async function getSyncScheduleStatus(): Promise<{
  lastAutomatic: SyncRunRow | null;
  lastManual: { run: SyncRunRow | null; triggeredAt: Date } | null;
}> {
  const [runs, manualTriggers] = await Promise.all([
    db
      .select()
      .from(syncRuns)
      .where(inArray(syncRuns.kind, ["incremental", "full"]))
      .orderBy(desc(syncRuns.startedAt))
      .limit(50),
    db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.action, "admin.sync.trigger"), eq(auditLog.targetType, "sync_run")))
      .orderBy(desc(auditLog.createdAt))
      .limit(50),
  ]);

  const nearManualTrigger = (d: Date) => manualTriggers.some((m) => Math.abs(m.createdAt.getTime() - d.getTime()) <= 60_000);

  const lastAutomatic = runs.find((r) => !nearManualTrigger(r.startedAt)) ?? null;
  const lastManualTrigger = manualTriggers[0] ?? null;
  const lastManualRun = lastManualTrigger
    ? (runs.find((r) => Math.abs(r.startedAt.getTime() - lastManualTrigger.createdAt.getTime()) <= 60_000) ?? null)
    : null;

  return {
    lastAutomatic,
    lastManual: lastManualTrigger ? { run: lastManualRun, triggeredAt: lastManualTrigger.createdAt } : null,
  };
}

export async function getPropertyUnresolved(): Promise<string[]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "propertyUnresolved")).limit(1);
  const value = row?.value;
  return Array.isArray(value) ? (value as string[]) : [];
}

export async function getHealthCounts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [[userCount], [bookCount], [weeklyActive], unmappedStages] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(books),
    db.select({ n: count() }).from(users).where(gte(users.lastLoginAt, sevenDaysAgo)),
    listUnmappedStageValues(),
  ]);
  return {
    users: userCount?.n ?? 0,
    books: bookCount?.n ?? 0,
    weeklyActive: weeklyActive?.n ?? 0,
    unmappedStages: unmappedStages.length,
    configuredProviders: configuredProviders(),
  };
}
