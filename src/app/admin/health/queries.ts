import "server-only";
import { count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, books, handbookVersions, syncRuns, users } from "@/db/schema";
import { configuredProviders } from "@/lib/env";
import { listUnmappedStageValues } from "../stages/queries";

export async function listRecentSyncRuns() {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(20);
}

export async function getActiveHandbook() {
  const [row] = await db.select().from(handbookVersions).where(eq(handbookVersions.isActive, true)).limit(1);
  return row ?? null;
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
