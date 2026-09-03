import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { books, visibleFiles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getDriveReader, type DriveFile } from "./client";

/**
 * Admin-only helpers for curating which Drive files an author sees. Read-only against Drive
 * itself (via DriveReader); the only writes here are to our own `visible_files` / `books` rows.
 */

export type AdminDriveFile = DriveFile & {
  /** Whether this file is currently shown to the author for this book. */
  visible: boolean;
  visibleFileId: string | null;
  label: string;
  category: string;
};

/** Lists a Drive folder's contents joined with this book's `visible_files` so the admin UI can show a checklist. */
export async function listFolderForAdmin(bookId: string, folderId: string): Promise<AdminDriveFile[]> {
  const [files, visibleRows] = await Promise.all([
    getDriveReader().listFolder(folderId),
    db.select().from(visibleFiles).where(eq(visibleFiles.bookId, bookId)),
  ]);
  const byDriveId = new Map(visibleRows.map((v) => [v.driveFileId, v]));
  return files.map((f) => {
    const v = byDriveId.get(f.id);
    return {
      ...f,
      visible: !!v,
      visibleFileId: v?.id ?? null,
      label: v?.label ?? f.name,
      category: v?.category ?? "Other",
    };
  });
}

export type SetFileVisibilityInput = {
  visible: boolean;
  label?: string;
  category?: string;
  /** Drive-reported mime type; stored for FileGrid's thumbnail-eligibility check. */
  mimeType?: string | null;
};

/**
 * Upserts (or deletes) the `visible_files` row for one Drive file on one book, and audits the change.
 * `actorId` is the admin user making the change.
 */
export async function setFileVisibility(
  bookId: string,
  driveFileId: string,
  input: SetFileVisibilityInput,
  actorId: string,
): Promise<void> {
  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw new Error("Book not found");

  const [existing] = await db
    .select()
    .from(visibleFiles)
    .where(and(eq(visibleFiles.bookId, bookId), eq(visibleFiles.driveFileId, driveFileId)))
    .limit(1);

  if (!input.visible) {
    if (existing) {
      await db.delete(visibleFiles).where(eq(visibleFiles.id, existing.id));
    }
    await audit(actorId, "admin.file.visibility", {
      targetType: "book",
      targetId: bookId,
      meta: { driveFileId, visible: false },
    });
    return;
  }

  const label = input.label?.trim() || existing?.label || "Untitled file";
  const category = input.category?.trim() || existing?.category || "Other";

  if (existing) {
    await db
      .update(visibleFiles)
      .set({ label, category, mimeType: input.mimeType ?? existing.mimeType })
      .where(eq(visibleFiles.id, existing.id));
  } else {
    await db.insert(visibleFiles).values({
      bookId,
      driveFileId,
      label,
      category,
      mimeType: input.mimeType ?? null,
      createdById: actorId,
    });
  }

  await audit(actorId, "admin.file.visibility", {
    targetType: "book",
    targetId: bookId,
    meta: { driveFileId, visible: true, label, category },
  });
}

/** Sets the Drive folder linked to a book (its file browser root) and audits the change. */
export async function linkFolder(bookId: string, folderId: string, actorId: string): Promise<void> {
  const [book] = await db.select({ id: books.id, driveFolderId: books.driveFolderId }).from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw new Error("Book not found");

  await db.update(books).set({ driveFolderId: folderId, updatedAt: new Date() }).where(eq(books.id, bookId));

  await audit(actorId, "admin.book.link_folder", {
    targetType: "book",
    targetId: bookId,
    meta: { before: book.driveFolderId, after: folderId },
  });
}
