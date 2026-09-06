import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./schema";

/**
 * "Messages from your team" — read-only mirror of HubSpot Engagement Emails (type EMAIL /
 * INCOMING_EMAIL) logged on an author's Contact record. Populated by
 * `src/lib/hubspot/engagements.ts` via `src/lib/data/messages.ts`; nothing here is ever written
 * back to HubSpot. See CLAUDE.md's hard rule: HubSpot is read-only except `src/lib/hubspot/writes.ts`.
 *
 * NOTE for whoever re-exports this from `src/db/schema.ts` (`export * from "./schema-comms"`):
 * this file imports `users` from `./schema`, so the re-export must be placed AFTER the `users`
 * table is defined there (e.g. at the very end of the file) to avoid a circular-import ordering
 * problem where `users` is still `undefined` when this module's `pgTable(...)` calls run.
 */

/** "sent" = the Atmosphere team sent this to the author; "received" = the author replied. */
export const contactEmailDirectionEnum = pgEnum("contact_email_direction", ["sent", "received"]);

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hubspotEmailId: text("hubspot_email_id").notNull(),
    direction: contactEmailDirectionEnum("direction").notNull(),
    subject: text("subject"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    /** Recipient addresses (to + cc combined at ingest time), for display only. */
    toEmails: jsonb("to_emails").$type<string[]>().notNull().default([]),
    sentAt: timestamp("sent_at", { mode: "date" }).notNull(),
    /** First ~300 chars of plain text, for the list view. */
    snippet: text("snippet").notNull().default(""),
    /** Plain text, HTML stripped, capped at 20k chars. Null if the email had no body. */
    bodyText: text("body_text"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_emails_user_hubspot_idx").on(t.userId, t.hubspotEmailId),
    index("contact_emails_user_sent_idx").on(t.userId, t.sentAt),
  ],
);

/** One row per author: when we last refreshed their messages from HubSpot, and the last error (if any). */
export const contactEmailSync = pgTable("contact_email_sync", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
  lastError: text("last_error"),
});

export type ContactEmail = typeof contactEmails.$inferSelect;
export type ContactEmailSync = typeof contactEmailSync.$inferSelect;
