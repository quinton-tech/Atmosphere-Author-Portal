import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, users } from "@/db/schema";
import { authorUploads } from "@/db/schema-uploads";
import { PAGE_SIZE, decodeCursor, encodeCursor } from "../_lib/cursor";

export type AdminUploadRow = {
  id: string;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
  authorEmail: string;
  bookTitle: string | null;
  fileName: string;
  sizeBytes: number;
  kind: string;
  status: string;
  note: string | null;
  driveWebViewLink: string | null;
};

type Cursor = { createdAt: string; id: string };

/** Recent uploads across every author, newest first, keyset-paginated. Admin-only — never
 *  scoped to a single user, which is why this lives beside the admin page rather than in
 *  src/lib/data/uploads.ts (that module is for the author's own ownership-scoped reads). */
export async function listUploadsForAdmin(opts: { cursor?: string } = {}): Promise<{
  rows: AdminUploadRow[];
  nextCursor: string | null;
}> {
  const cursor = decodeCursor<Cursor>(opts.cursor);
  const cursorCond = cursor
    ? sql`(${authorUploads.createdAt}, ${authorUploads.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`
    : undefined;

  const rows = await db
    .select({
      upload: authorUploads,
      authorName: users.name,
      authorEmail: users.email,
      bookTitle: books.title,
    })
    .from(authorUploads)
    .innerJoin(users, eq(users.id, authorUploads.userId))
    .leftJoin(books, eq(books.id, authorUploads.bookId))
    .where(cursorCond ? and(cursorCond) : undefined)
    .orderBy(desc(authorUploads.createdAt), desc(authorUploads.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.upload.createdAt.toISOString(), id: last.upload.id } satisfies Cursor)
      : null;

  return {
    rows: page.map((r) => ({
      id: r.upload.id,
      createdAt: r.upload.createdAt,
      authorId: r.upload.userId,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      bookTitle: r.bookTitle,
      fileName: r.upload.fileName,
      sizeBytes: r.upload.sizeBytes,
      kind: r.upload.kind,
      status: r.upload.status,
      note: r.upload.note,
      driveWebViewLink: r.upload.driveWebViewLink,
    })),
    nextCursor,
  };
}
