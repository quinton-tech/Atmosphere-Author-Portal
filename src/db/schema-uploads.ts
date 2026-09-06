import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { books, users } from "./schema";

/**
 * Author-initiated uploads (manuscripts, signed forms, misc files) sent *to* Atmosphere Press.
 * This is the one exception to the "Drive is read-only" hard rule in CLAUDE.md: files land in
 * Google Drive through a separate, write-scoped service account (`drive.file` only — see
 * `src/lib/drive/uploads.ts`, the only module allowed to call a Drive write method), never
 * through the read-only `DriveReader` in `src/lib/drive/client.ts`.
 *
 * NOTE FOR LEAD: this table lives in its own file (rather than `src/db/schema.ts`) only because
 * of a concurrent edit conflict during development. Please re-export it from `schema.ts` (e.g.
 * `export * from "./schema-uploads"`) so `db:generate` picks it up in the normal migration flow.
 */
export const authorUploads = pgTable(
  "author_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional: which book this file is for. Null means "not tied to a specific book". */
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    /** Drive file id in the uploads-owned folder tree. "demo-<uuid>" in demo mode (no real Drive call). */
    driveFileId: text("drive_file_id").notNull(),
    /** The leaf folder (author/book) the file was placed in. Null in demo mode. */
    driveFolderId: text("drive_folder_id"),
    /** Staff-facing Drive link, shown only in /admin/uploads — never surfaced to authors. */
    driveWebViewLink: text("drive_web_view_link"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    kind: text("kind").$type<"manuscript" | "form" | "other">().notNull().default("other"),
    /** Optional note from the author to their team, shown to staff alongside the file. */
    note: text("note"),
    status: text("status").$type<"stored" | "demo" | "failed">().notNull().default("stored"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("author_uploads_user_created_idx").on(t.userId, t.createdAt),
    index("author_uploads_book_idx").on(t.bookId),
  ],
);

export type AuthorUpload = typeof authorUploads.$inferSelect;
export type NewAuthorUpload = typeof authorUploads.$inferInsert;
