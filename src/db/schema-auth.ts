import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Backing store for the auth rate limiters (src/lib/auth/rate-limit.ts). Previously an in-memory
 * Map per limiter, which reset on every deploy and didn't share state across serverless
 * instances — meaning at >1 instance the real limit was effectively `max * instanceCount`. This
 * table makes it a single shared, atomic counter regardless of how many instances are running.
 *
 * `key` encodes both the limiter and the identity being limited, e.g. `login:email:a@b.com`,
 * `login:ip:1.2.3.4`, `reset:email:a@b.com`, `reset:ip:1.2.3.4`, `totp:user:<uuid>` — see
 * rate-limit.ts's callers for the exact prefixes.
 *
 * NOT exported from src/db/schema.ts yet — that re-export (and the `db:push` to create the table)
 * is the lead's to do, since src/db/schema.ts is off-limits to this change. rate-limit.ts imports
 * this table directly from here in the meantime; the physical table just needs to exist in
 * Postgres for the queries to work.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowEnds: timestamp("window_ends", { mode: "date" }).notNull(),
});

export type RateLimit = typeof rateLimits.$inferSelect;
