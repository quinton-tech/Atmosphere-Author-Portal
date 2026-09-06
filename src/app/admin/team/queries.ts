import "server-only";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers, type TeamMemberRow } from "@/db/schema-team";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

type Cursor = { name: string; id: string };

/** 50/page even though there are only ~68 rows today — the pattern holds if the team grows. */
export async function listTeamMembers(opts: { cursor?: string }): Promise<{ rows: TeamMemberRow[]; nextCursor: string | null }> {
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const cursorCond = cursor ? sql`(${teamMembers.name}, ${teamMembers.id}) > (${cursor.name}, ${cursor.id})` : undefined;

  const rows = await db
    .select()
    .from(teamMembers)
    .where(cursorCond)
    .orderBy(asc(teamMembers.name), asc(teamMembers.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ name: last.name, id: last.id } satisfies Cursor) : null;
  return { rows: page, nextCursor };
}

export async function getLastImportedAt(): Promise<Date | null> {
  const [row] = await db.select({ importedAt: teamMembers.importedAt }).from(teamMembers).orderBy(desc(teamMembers.importedAt)).limit(1);
  return row?.importedAt ?? null;
}
