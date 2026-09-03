import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookCache, books, stageConfig, users } from "@/db/schema";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

export type AuthorRow = {
  id: string;
  name: string | null;
  email: string;
  role: "author" | "admin";
  lastLoginAt: Date | null;
  invitedAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  books: { id: string; title: string; stageLabel: string }[];
};

type Cursor = { createdAt: string; id: string };

export async function listAuthors(opts: { q?: string; cursor?: string }): Promise<{
  rows: AuthorRow[];
  nextCursor: string | null;
}> {
  const q = opts.q?.trim();
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const like = q ? `%${q}%` : null;

  const searchCond = like
    ? or(
        ilike(users.name, like),
        ilike(users.email, like),
        sql`EXISTS (SELECT 1 FROM ${books} WHERE ${books.userId} = ${users.id} AND ${books.title} ILIKE ${like})`,
      )
    : undefined;

  const cursorCond = cursor
    ? sql`(${users.createdAt}, ${users.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`
    : undefined;

  const conds = [searchCond, cursorCond].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      lastLoginAt: users.lastLoginAt,
      invitedAt: users.invitedAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id } satisfies Cursor) : null;

  const ids = page.map((r) => r.id);
  const booksByUser = new Map<string, { id: string; title: string; stageLabel: string }[]>();
  if (ids.length) {
    const stages = await db.select().from(stageConfig);
    const stageByKey = new Map(stages.map((s) => [s.key, s.label]));
    const bookRows = await db
      .select({ id: books.id, userId: books.userId, title: books.title, stageKey: bookCache.stageKey, raw: bookCache.properties })
      .from(books)
      .leftJoin(bookCache, eq(bookCache.bookId, books.id))
      .where(inArray(books.userId, ids));
    for (const b of bookRows) {
      const stageLabel = (b.stageKey && stageByKey.get(b.stageKey)) || b.raw?.pipelineStage || "In production";
      const list = booksByUser.get(b.userId) ?? [];
      list.push({ id: b.id, title: b.title, stageLabel });
      booksByUser.set(b.userId, list);
    }
  }

  return {
    rows: page.map((r) => ({ ...r, books: booksByUser.get(r.id) ?? [] })),
    nextCursor,
  };
}

export async function getAuthorSummary(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}
