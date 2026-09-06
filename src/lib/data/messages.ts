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

/**
 * - "not_connected": this author isn't linked to a HubSpot contact at all — nothing has ever been
 *   attempted.
 * - "unavailable": the most recent attempt failed with a HubSpot scope error (missing
 *   `sales-email-read`), or it failed and there has never been a successful sync — nothing useful
 *   to show.
 * - "stale_error": cached messages exist (from a past successful sync), but the latest refresh
 *   attempt failed — show the cache with a "couldn't refresh" note.
 * - "empty": synced successfully at least once, with zero messages.
 * - "ok": synced successfully with messages to show.
 */
export type MessagesState = "not_connected" | "unavailable" | "stale_error" | "empty" | "ok";

export type MessagesResult = {
  messages: MessageSummary[];
  state: MessagesState;
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

/** Only ever written on a SUCCESSFUL sync — `lastSyncedAt` means "last time this actually worked."
 *  Clears any previous error, since the cache is now current. */
async function markSyncSuccess(userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(contactEmailSync)
    .values({ userId, lastSyncedAt: now, lastError: null })
    .onConflictDoUpdate({ target: contactEmailSync.userId, set: { lastSyncedAt: now, lastError: null } });
}

/** Records a failed attempt WITHOUT touching `lastSyncedAt` — `contact_email_sync` has no separate
 *  "last attempt" column, so leaving the last-success timestamp alone (rather than bumping it, as
 *  this used to do) is what lets `getMessagesForUser` tell "never synced" apart from "synced once,
 *  a while ago, and the most recent refresh failed." It also keeps the cache "stale" so the next
 *  request tries again rather than waiting out a full REFRESH_INTERVAL_MS on a row that never
 *  actually succeeded. */
async function markSyncFailure(userId: string, message: string): Promise<void> {
  await db
    .insert(contactEmailSync)
    .values({ userId, lastSyncedAt: null, lastError: message })
    .onConflictDoUpdate({ target: contactEmailSync.userId, set: { lastError: message } });
}

/** Refresh this user's cached messages from HubSpot if stale (or never successfully synced) and
 *  they're linked to a HubSpot contact. Never throws — a HubSpot failure is recorded on
 *  `contact_email_sync.lastError` and swallowed, so the caller always falls back to whatever's
 *  cached. Returns whether THIS attempt specifically hit a scope error, for the caller's state
 *  computation (a scope error is permanent, so it always reads as "unavailable" even once the
 *  request below re-reads a `lastError` that might otherwise look like a transient blip). */
async function refreshIfStale(userId: string, hubspotContactId: string | null, email: string): Promise<{ scopeErrorNow: boolean }> {
  if (isDemoMode() || !hubspotContactId) return { scopeErrorNow: false };

  const [syncRow] = await db.select().from(contactEmailSync).where(eq(contactEmailSync.userId, userId)).limit(1);
  const isStale = !syncRow?.lastSyncedAt || Date.now() - syncRow.lastSyncedAt.getTime() > REFRESH_INTERVAL_MS;
  if (!isStale) return { scopeErrorNow: false };

  try {
    const records = await fetchContactEmails(hubspotContactId, email);
    await replaceCachedMessages(userId, records);
    await markSyncSuccess(userId);
    return { scopeErrorNow: false };
  } catch (err) {
    const scopeError = err instanceof EngagementsScopeError;
    const message = err instanceof Error ? err.message : String(err);
    await markSyncFailure(userId, message);
    return { scopeErrorNow: scopeError };
  }
}

/** Messages for one author, newest first, plus a `state` describing how trustworthy/complete that
 *  list is (see `MessagesState`). Refreshes from HubSpot first if the cache is stale (>10 min old)
 *  and the author is linked to a HubSpot contact; always returns whatever's cached regardless of
 *  what that refresh did. */
export async function getMessagesForUser(userId: string): Promise<MessagesResult> {
  const [user] = await db
    .select({ email: users.email, hubspotContactId: users.hubspotContactId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.hubspotContactId) {
    return { messages: [], state: "not_connected", lastSyncedAt: null };
  }

  const { scopeErrorNow } = await refreshIfStale(userId, user.hubspotContactId, user.email);

  const [rows, [syncRow]] = await Promise.all([
    db.select().from(contactEmails).where(eq(contactEmails.userId, userId)).orderBy(desc(contactEmails.sentAt)),
    db.select().from(contactEmailSync).where(eq(contactEmailSync.userId, userId)).limit(1),
  ]);
  const messages = rows.map(toSummary);

  let state: MessagesState;
  if (scopeErrorNow) {
    state = "unavailable";
  } else if (syncRow?.lastError) {
    state = syncRow.lastSyncedAt && messages.length > 0 ? "stale_error" : "unavailable";
  } else if (messages.length === 0) {
    state = "empty";
  } else {
    state = "ok";
  }

  return { messages, state, lastSyncedAt: syncRow?.lastSyncedAt?.toISOString() ?? null };
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
