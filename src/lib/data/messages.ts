import "server-only";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactEmails, contactEmailSync, type ContactEmail } from "@/db/schema-comms";
import { users } from "@/db/schema";
import { isDemoMode } from "@/lib/env";
import { EngagementsScopeError, fetchContactEmails, type ContactEmailRecord } from "@/lib/hubspot/engagements";

/**
 * All data access for "Messages from your team" (HubSpot Engagement Emails logged on the
 * author's Contact). Scoped by userId, matching the pattern in `src/lib/data/books.ts` — no
 * `getMessageById(id)` without a userId exists here on purpose. Reads only; nothing here writes
 * to HubSpot (see CLAUDE.md's hard rule).
 */

export type MessageSummary = {
  id: string;
  hubspotEmailId: string;
  direction: "sent" | "received";
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  sentAt: string; // ISO
  snippet: string;
};

export type MessageDetail = MessageSummary & { bodyText: string | null };

export type MessagesResult = {
  messages: MessageSummary[];
  /** True if the last refresh attempt failed with a HubSpot scope error (missing
   *  `sales-email-read`) — the UI shows "messages aren't available yet" rather than erroring. */
  unavailable: boolean;
  lastSyncedAt: string | null;
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function toSummary(row: ContactEmail): MessageSummary {
  return {
    id: row.id,
    hubspotEmailId: row.hubspotEmailId,
    direction: row.direction as "sent" | "received",
    subject: row.subject,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    toEmails: row.toEmails,
    sentAt: row.sentAt.toISOString(),
    snippet: row.snippet,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// drizzle-orm's `sql` helper for referencing the EXCLUDED pseudo-table in ON CONFLICT DO UPDATE
// (same pattern as `src/lib/hubspot/sync.ts`'s `sqlExcluded`, duplicated locally to avoid a
// cross-import into a file another agent is concurrently editing).
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/** Replace this user's cached messages with `records` (upsert by hubspotEmailId, delete anything
 *  no longer present). A no-op if `records` matches what's cached, aside from re-writing rows. */
async function replaceCachedMessages(userId: string, records: ContactEmailRecord[]): Promise<void> {
  const incomingIds = records.map((r) => r.hubspotEmailId);

  if (incomingIds.length > 0) {
    await db.delete(contactEmails).where(and(eq(contactEmails.userId, userId), notInArray(contactEmails.hubspotEmailId, incomingIds)));
  } else {
    await db.delete(contactEmails).where(eq(contactEmails.userId, userId));
  }

  for (const batch of chunk(records, 200)) {
    if (batch.length === 0) continue;
    await db
      .insert(contactEmails)
      .values(
        batch.map((r) => ({
          userId,
          hubspotEmailId: r.hubspotEmailId,
          direction: r.direction,
          subject: r.subject,
          fromName: r.fromName,
          fromEmail: r.fromEmail,
          toEmails: r.toEmails,
          sentAt: r.sentAt,
          snippet: r.snippet,
          bodyText: r.bodyText,
        })),
      )
      .onConflictDoUpdate({
        target: [contactEmails.userId, contactEmails.hubspotEmailId],
        set: {
          direction: sqlExcluded("direction"),
          subject: sqlExcluded("subject"),
          fromName: sqlExcluded("from_name"),
          fromEmail: sqlExcluded("from_email"),
          toEmails: sqlExcluded("to_emails"),
          sentAt: sqlExcluded("sent_at"),
          snippet: sqlExcluded("snippet"),
          bodyText: sqlExcluded("body_text"),
        },
      });
  }
}

async function markSynced(userId: string, lastError: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(contactEmailSync)
    .values({ userId, lastSyncedAt: now, lastError })
    .onConflictDoUpdate({ target: contactEmailSync.userId, set: { lastSyncedAt: now, lastError } });
}

/** Refresh this user's cached messages from HubSpot if stale (or never synced) and they're linked
 *  to a HubSpot contact. Returns whether messages are currently unavailable (missing scope). Never
 *  throws — a HubSpot failure is recorded on `contact_email_sync.lastError` and swallowed, so the
 *  caller always falls back to whatever's cached. */
async function refreshIfStale(userId: string): Promise<{ unavailable: boolean }> {
  if (isDemoMode()) return { unavailable: false };

  const [user] = await db
    .select({ email: users.email, hubspotContactId: users.hubspotContactId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.hubspotContactId) return { unavailable: false };

  const [syncRow] = await db.select().from(contactEmailSync).where(eq(contactEmailSync.userId, userId)).limit(1);
  const isStale = !syncRow?.lastSyncedAt || Date.now() - syncRow.lastSyncedAt.getTime() > REFRESH_INTERVAL_MS;
  if (!isStale) return { unavailable: !!syncRow?.lastError };

  try {
    const records = await fetchContactEmails(user.hubspotContactId, user.email);
    await replaceCachedMessages(userId, records);
    await markSynced(userId, null);
    return { unavailable: false };
  } catch (err) {
    const scopeError = err instanceof EngagementsScopeError;
    const message = err instanceof Error ? err.message : String(err);
    await markSynced(userId, message);
    return { unavailable: scopeError };
  }
}

/** Messages for one author, newest first. Refreshes from HubSpot first if the cache is stale
 *  (>10 min old) and the author is linked to a HubSpot contact; otherwise serves the cache as-is. */
export async function getMessagesForUser(userId: string): Promise<MessagesResult> {
  const { unavailable } = await refreshIfStale(userId);

  const rows = await db.select().from(contactEmails).where(eq(contactEmails.userId, userId)).orderBy(desc(contactEmails.sentAt));
  const [syncRow] = await db.select().from(contactEmailSync).where(eq(contactEmailSync.userId, userId)).limit(1);

  return {
    messages: rows.map(toSummary),
    unavailable,
    lastSyncedAt: syncRow?.lastSyncedAt?.toISOString() ?? null,
  };
}

/** One message, only if it belongs to `userId`. Does not trigger a refresh — the list view already
 *  did, and a permalink shouldn't cause a surprise HubSpot round trip. */
export async function getMessageForUser(userId: string, id: string): Promise<MessageDetail | null> {
  const [row] = await db
    .select()
    .from(contactEmails)
    .where(and(eq(contactEmails.id, id), eq(contactEmails.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { ...toSummary(row), bodyText: row.bodyText };
}
