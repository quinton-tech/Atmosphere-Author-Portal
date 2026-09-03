import "server-only";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

type Cursor = { createdAt: string; id: string };

export async function listAuditEntries(opts: { action?: string; actor?: string; cursor?: string }) {
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const conds = [];
  if (opts.action?.trim()) conds.push(ilike(auditLog.action, `%${opts.action.trim()}%`));
  if (opts.actor?.trim()) conds.push(ilike(users.email, `%${opts.actor.trim()}%`));
  if (cursor) conds.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({ entry: auditLog, actorEmail: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.entry.createdAt.toISOString(), id: last.entry.id } satisfies Cursor) : null;

  return { rows: page.map((r) => ({ ...r.entry, actorEmail: r.actorEmail })), nextCursor };
}
