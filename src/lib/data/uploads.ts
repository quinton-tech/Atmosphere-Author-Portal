import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { books, users } from "@/db/schema";
import { authorUploads, type AuthorUpload } from "@/db/schema-uploads";
import { audit, type AuditAction } from "@/lib/audit";
import { env, isDemoMode, isUploadsConfigured } from "@/lib/env";
import { listBooksForUser } from "@/lib/data/books";
import { ensureFolder, uploadFile } from "@/lib/drive/uploads";
import { sanitizeFilename } from "@/lib/drive/mime";
import { sendUploadNotificationEmail } from "@/lib/auth/email";

/**
 * All write logic for the one approved Drive-write exception (see CLAUDE.md hard rules and
 * src/lib/drive/uploads.ts). Like src/lib/data/books.ts, every read here is scoped by the
 * signed-in user's id — there is deliberately no "get any upload by id" without a userId.
 */

/** User-safe error: message is shown directly to the author. */
export class UploadError extends Error {}

export const UPLOAD_KINDS = ["manuscript", "form", "other"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const UPLOAD_MAX_PER_DAY = 20;

const ALLOWED_EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  rtf: "application/rtf",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  zip: "application/zip",
};

function extensionOf(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Checks the file's first bytes against its claimed extension for the types where a signature
 * exists and is cheap to check. docx and zip share the same "PK" signature (docx is a zip
 * container) — that's expected, not a bug. doc/rtf/txt have no single reliable magic number
 * worth enforcing here, so they pass through on extension/size checks alone.
 */
function matchesMagicBytes(extension: string, bytes: Uint8Array): boolean {
  const b = (i: number) => bytes[i] ?? -1;
  switch (extension) {
    case "pdf":
      return b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46; // %PDF
    case "png":
      return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47; // .PNG
    case "jpg":
    case "jpeg":
      return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff; // JPEG SOI + marker
    case "zip":
    case "docx":
      return b(0) === 0x50 && b(1) === 0x4b; // "PK"
    default:
      return true;
  }
}

/** Validates a File before it ever touches Drive or the database. Throws UploadError with
 *  author-facing copy on any rejection. Returns the canonical mime type to store. */
async function validateFile(file: File): Promise<{ mimeType: string; bytes: Buffer }> {
  const extension = extensionOf(file.name);
  if (!extension || !(extension in ALLOWED_EXTENSION_MIME)) {
    throw new UploadError(
      `We can't accept .${extension ?? "?"} files. Allowed types: ${Object.keys(ALLOWED_EXTENSION_MIME).join(", ")}.`,
    );
  }
  if (file.size <= 0) {
    throw new UploadError("That file looks empty. Please choose a different file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("That file is larger than 50 MB. Please send a smaller file, or ask your Author Manager for another way to share it.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagicBytes(extension, bytes)) {
    throw new UploadError("That file doesn't look like a valid " + extension.toUpperCase() + " file. Please check it and try again.");
  }

  return { mimeType: ALLOWED_EXTENSION_MIME[extension], bytes };
}

export type UploadListItem = {
  id: string;
  bookId: string | null;
  bookTitle: string | null;
  kind: UploadKind;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  status: AuthorUpload["status"];
  createdAt: string; // ISO
};

/** Ownership-scoped: newest first, capped at 100 — this is a "your recent sends" list, not an archive browser. */
export async function listUploadsForUser(userId: string): Promise<UploadListItem[]> {
  const rows = await db
    .select({ upload: authorUploads, bookTitle: books.title })
    .from(authorUploads)
    .leftJoin(books, eq(books.id, authorUploads.bookId))
    .where(eq(authorUploads.userId, userId))
    .orderBy(desc(authorUploads.createdAt))
    .limit(100);

  return rows.map(({ upload, bookTitle }) => ({
    id: upload.id,
    bookId: upload.bookId,
    bookTitle: bookTitle ?? null,
    kind: upload.kind,
    fileName: upload.fileName,
    sizeBytes: upload.sizeBytes,
    note: upload.note,
    status: upload.status,
    createdAt: upload.createdAt.toISOString(),
  }));
}

async function countUploadsToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: authorUploads.id })
    .from(authorUploads)
    .where(and(eq(authorUploads.userId, userId), gte(authorUploads.createdAt, since)))
    .limit(UPLOAD_MAX_PER_DAY);
  return rows.length;
}

export type CreateUploadInput = {
  /** Must belong to `userId` if provided — checked via listBooksForUser, never trusted as-is. */
  bookId?: string | null;
  kind: UploadKind;
  note?: string | null;
  file: File;
};

/**
 * Validates, rate-limits, uploads to Drive (or fakes it in demo mode), records the row, audits,
 * and notifies staff. Every step that can fail throws UploadError with author-safe copy.
 */
export async function createUploadForUser(userId: string, input: CreateUploadInput): Promise<AuthorUpload> {
  if (await countUploadsToday(userId) >= UPLOAD_MAX_PER_DAY) {
    throw new UploadError(`You've reached today's limit of ${UPLOAD_MAX_PER_DAY} uploads. Please try again tomorrow.`);
  }

  let bookTitle: string | null = null;
  if (input.bookId) {
    const ownedBooks = await listBooksForUser(userId);
    const owned = ownedBooks.find((b) => b.id === input.bookId);
    if (!owned) {
      throw new UploadError("That book isn't associated with your account.");
    }
    bookTitle = owned.title;
  }

  const { mimeType, bytes } = await validateFile(input.file);
  const fileName = sanitizeFilename(input.file.name || "upload");
  const note = input.note?.trim() || null;

  const [user] = await db.select({ id: users.id, name: users.name, email: users.email, hubspotContactId: users.hubspotContactId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new UploadError("We couldn't find your account. Please sign in again.");
  const authorName = user.name?.trim() || user.email;

  let driveFileId: string;
  let driveFolderId: string | null = null;
  let driveWebViewLink: string | null = null;
  let status: AuthorUpload["status"] = "stored";

  if (isDemoMode()) {
    // Demo mode never touches Google: no service account is configured. Fake an id so the row
    // still round-trips through the UI exactly like a real upload would.
    driveFileId = `demo-${randomUUID()}`;
    status = "demo";
  } else {
    if (!isUploadsConfigured() || !env.GOOGLE_UPLOADS_ROOT_FOLDER_ID) {
      throw new UploadError("Uploads aren't set up yet. Please contact your Author Manager.");
    }
    const rootFolderId = env.GOOGLE_UPLOADS_ROOT_FOLDER_ID;
    const authorFolderName = sanitizeFilename(`${authorName} (${user.hubspotContactId ?? user.id})`);
    const bookFolderName = sanitizeFilename(bookTitle ?? "General");
    try {
      const authorFolderId = await ensureFolder(rootFolderId, authorFolderName);
      const bookFolderId = await ensureFolder(authorFolderId, bookFolderName);
      const uploaded = await uploadFile({ folderId: bookFolderId, name: fileName, mimeType, bytes });
      driveFileId = uploaded.id;
      driveFolderId = bookFolderId;
      driveWebViewLink = uploaded.webViewLink;
    } catch (err) {
      await audit(
        userId,
        "author.upload.failed",
        { targetType: "author_upload", meta: { fileName, error: err instanceof Error ? err.message : String(err) } },
      );
      throw new UploadError("We couldn't send that file just now. Please try again in a moment.");
    }
  }

  const [row] = await db
    .insert(authorUploads)
    .values({
      userId,
      bookId: input.bookId || null,
      driveFileId,
      driveFolderId,
      driveWebViewLink,
      fileName,
      mimeType,
      sizeBytes: input.file.size,
      kind: input.kind,
      note,
      status,
    })
    .returning();

  await audit(
    userId,
    "author.upload",
    {
      targetType: "author_upload",
      targetId: row.id,
      meta: { fileName, sizeBytes: input.file.size, kind: input.kind, bookId: input.bookId ?? null, status },
    },
  );

  if (!isDemoMode() && env.RESEND_API_KEY && env.UPLOADS_NOTIFY_EMAIL) {
    try {
      await sendUploadNotificationEmail(env.UPLOADS_NOTIFY_EMAIL, {
        authorName,
        bookTitle,
        fileName,
        sizeBytes: input.file.size,
        driveWebViewLink,
      });
    } catch {
      // Notification is best-effort — the file is already safely stored and audited, so a
      // failed email must not fail the upload for the author.
    }
  }

  return row;
}
