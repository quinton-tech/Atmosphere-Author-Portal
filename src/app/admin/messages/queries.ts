import "server-only";
import { count, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { contactEmails, contactEmailSync } from "@/db/schema-comms";
import { users } from "@/db/schema";

export type MessageSyncRow = {
  userId: string;
  email: string;
  name: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  messageCount: number;
};

/** Every author who has a `contact_email_sync` row, most-recently-synced first — mainly useful
 *  for spotting a missing `sales-email-read` scope (every row's `lastError` set at once). */
export async function listMessageSyncRows(): Promise<MessageSyncRow[]> {
  const rows = await db
    .select({
      userId: contactEmailSync.userId,
      email: users.email,
      name: users.name,
      lastSyncedAt: contactEmailSync.lastSyncedAt,
      lastError: contactEmailSync.lastError,
    })
    .from(contactEmailSync)
    .innerJoin(users, eq(users.id, contactEmailSync.userId))
    .orderBy(desc(contactEmailSync.lastSyncedAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({ userId: contactEmails.userId, n: count() })
    .from(contactEmails)
    .groupBy(contactEmails.userId);
  const countByUser = new Map(counts.map((c) => [c.userId, c.n]));

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastError: r.lastError,
    messageCount: countByUser.get(r.userId) ?? 0,
  }));
}

export async function getMessageHealthCounts(): Promise<{ syncedAuthors: number; erroredAuthors: number; totalMessages: number }> {
  const [[synced], [errored], [total]] = await Promise.all([
    db.select({ n: count() }).from(contactEmailSync),
    db.select({ n: count() }).from(contactEmailSync).where(isNotNull(contactEmailSync.lastError)),
    db.select({ n: count() }).from(contactEmails),
  ]);
  return {
    syncedAuthors: synced?.n ?? 0,
    erroredAuthors: errored?.n ?? 0,
    totalMessages: total?.n ?? 0,
  };
}
