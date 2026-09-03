import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookCache, books, stageConfig, users } from "@/db/schema";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

export type BookRow = {
  id: string;
  title: string;
  userId: string;
  authorName: string | null;
  authorEmail: string;
  stageLabel: string;
  isArchived: boolean;
  updatedAt: Date;
};

type Cursor = { updatedAt: string; id: string };

export async function listBooks(opts: { q?: string; cursor?: string }): Promise<{ rows: BookRow[]; nextCursor: string | null }> {
  const q = opts.q?.trim();
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const like = q ? `%${q}%` : null;

  const searchCond = like ? or(ilike(books.title, like), ilike(users.name, like), ilike(users.email, like)) : undefined;
  const cursorCond = cursor ? sql`(${books.updatedAt}, ${books.id}) < (${new Date(cursor.updatedAt)}, ${cursor.id})` : undefined;
  const conds = [searchCond, cursorCond].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conds.length ? and(...conds) : undefined;

  const stages = await db.select().from(stageConfig);
  const stageByKey = new Map(stages.map((s) => [s.key, s.label]));

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      userId: books.userId,
      authorName: users.name,
      authorEmail: users.email,
      stageKey: bookCache.stageKey,
      raw: bookCache.properties,
      archivedAt: books.archivedAt,
      updatedAt: books.updatedAt,
    })
    .from(books)
    .innerJoin(users, eq(users.id, books.userId))
    .leftJoin(bookCache, eq(bookCache.bookId, books.id))
    .where(where)
    .orderBy(desc(books.updatedAt), desc(books.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id } satisfies Cursor) : null;

  return {
    rows: page.map((r) => ({
      id: r.id,
      title: r.title,
      userId: r.userId,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      stageLabel: (r.stageKey && stageByKey.get(r.stageKey)) || r.raw?.pipelineStage || "In production",
      isArchived: !!r.archivedAt,
      updatedAt: r.updatedAt,
    })),
    nextCursor,
  };
}
