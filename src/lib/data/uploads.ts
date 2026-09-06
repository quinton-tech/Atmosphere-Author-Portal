import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { books, users } from "@/db/schema";
import { authorUploads, type AuthorUpload } from "@/db/schema-uploads";
import { audit } from "@/lib/audit";
import { env, isDemoMode, isUploadsConfigured } from "@/lib/env";
import { listBooksForUser } from "@/lib/data/books";
import { createResumableSession, ensureFolder, finalizeUploadedFile } from "@/lib/drive/uploads";
import { sanitizeFilename } from "@/lib/drive/mime";
import { sendUploadNotificationEmail } from "@/lib/auth/email";
import {
  DEMO_MAX_UPLOAD_BYTES,
  isPendingExpired,
  MAX_UPLOAD_BYTES,
  UPLOAD_KINDS,
  UPLOAD_MAX_PER_DAY,
  UploadError,
  validateUploadMeta,
  type UploadKind,
} from "./uploads-validation";

/**
 * All write logic for the one approved Drive-write exception (see CLAUDE.md hard rules and
 * src/lib/drive/uploads.ts). Like src/lib/data/books.ts, every read here is scoped by the
 * signed-in user's id — there is deliberately no "get any upload by id" without a userId.
 *
 * Two-step, direct-to-Drive protocol (bytes never pass through this server):
 *   1. createUploadSessionForUser — all validation up front, ensures the Drive folder tree,
 *      opens a resumable session, inserts a "pending" row. The browser then PUTs the file
 *      straight to Drive using the returned session URI.
 *   2. completeUploadForUser — called after the browser's PUT finishes; confirms with Drive
 *      what actually landed and flips the row to "stored" (or "demo").
 * See src/app/api/uploads/session/route.ts and .../complete/route.ts.
 */

export { UploadError, UPLOAD_KINDS, UPLOAD_MAX_PER_DAY, type UploadKind };

/**
 * The `status` column (src/db/schema-uploads.ts) is typed `"stored" | "demo" | "failed"` only —
 * that file is off-limits to this change (see the task's scoping notes), and a fourth status is
 * genuinely needed for "the browser hasn't finished PUTting bytes to Drive yet". The column
 * itself is plain Postgres `text` with no CHECK constraint, so "pending" round-trips at runtime
 * exactly like the three known values; this cast only satisfies the narrower compile-time type
 * without touching the schema file. Every use of PENDING below is one of the "existing columns,
 * used differently" the task calls for — no new column, no schema change.
 */
const PENDING = "pending" as unknown as AuthorUpload["status"];

async function countUploadsToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: authorUploads.id })
    .from(authorUploads)
    .where(and(eq(authorUploads.userId, userId), gte(authorUploads.createdAt, since)))
    .limit(UPLOAD_MAX_PER_DAY);
  return rows.length;
}

/** Marks this user's own stale "pending" rows "failed" — the "or on the next session creation for
 *  that user" half of the 24h cleanup rule (the other half is the cron sweep below). Cheap: a
 *  user has at most UPLOAD_MAX_PER_DAY rows/day, so this never scans more than a handful. */
async function expirePendingUploadsForUser(userId: string): Promise<void> {
  const rows = await db
    .select({ id: authorUploads.id, createdAt: authorUploads.createdAt })
    .from(authorUploads)
    .where(and(eq(authorUploads.userId, userId), eq(authorUploads.status, PENDING)));
  const staleIds = rows.filter((r) => isPendingExpired(r.createdAt)).map((r) => r.id);
  if (staleIds.length === 0) return;
  await db.update(authorUploads).set({ status: "failed" }).where(inArray(authorUploads.id, staleIds));
}

/** Global sweep for the cron route (src/app/api/cron/sync/route.ts): any user's "pending" row
 *  older than 24h — abandoned mid-upload, or the browser never called .../complete — is marked
 *  "failed" so it stops showing as "Sending…" forever. Returns how many rows were expired. */
export async function expireStalePendingUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const updated = await db
    .update(authorUploads)
    .set({ status: "failed" })
    .where(and(eq(authorUploads.status, PENDING), lt(authorUploads.createdAt, cutoff)))
    .returning({ id: authorUploads.id });
  return updated.length;
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

function toListItem(upload: AuthorUpload, bookTitle: string | null): UploadListItem {
  return {
    id: upload.id,
    bookId: upload.bookId,
    bookTitle,
    kind: upload.kind,
    fileName: upload.fileName,
    sizeBytes: upload.sizeBytes,
    note: upload.note,
    status: upload.status,
    createdAt: upload.createdAt.toISOString(),
  };
}

/** Ownership-scoped: newest first, capped at 100 — this is a "your recent sends" list, not an archive browser. */
export async function listUploadsForUser(userId: string): Promise<UploadListItem[]> {
  const rows = await db
    .select({ upload: authorUploads, bookTitle: books.title })
    .from(authorUploads)
    .leftJoin(books, eq(books.id, authorUploads.bookId))
    .where(eq(authorUploads.userId, userId))
    .orderBy(desc(authorUploads.createdAt))
    .limit(100);

  return rows.map(({ upload, bookTitle }) => toListItem(upload, bookTitle ?? null));
}

/** Ownership-scoped to one book: the inner join only matches rows where `bookId` belongs to
 *  `userId`, so an author can never see another author's uploads by guessing a bookId. Newest
 *  first, capped at 100 for the same "recent sends, not an archive" reason as listUploadsForUser. */
export async function listUploadsForBook(userId: string, bookId: string): Promise<UploadListItem[]> {
  const rows = await db
    .select({ upload: authorUploads, bookTitle: books.title })
    .from(authorUploads)
    .innerJoin(books, and(eq(books.id, authorUploads.bookId), eq(books.userId, userId)))
    .where(and(eq(authorUploads.bookId, bookId), eq(authorUploads.userId, userId)))
    .orderBy(desc(authorUploads.createdAt))
    .limit(100);

  return rows.map(({ upload, bookTitle }) => toListItem(upload, bookTitle ?? null));
}

type UserRow = { id: string; name: string | null; email: string; hubspotContactId: string | null };

async function getUserRow(userId: string): Promise<UserRow> {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, hubspotContactId: users.hubspotContactId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new UploadError("We couldn't find your account. Please sign in again.");
  return user;
}

export type CreateUploadSessionInput = {
  /** Must belong to `userId` if provided — checked via listBooksForUser, never trusted as-is. */
  bookId?: string | null;
  kind: UploadKind;
  note?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type UploadSessionResult = {
  uploadId: string;
  /** null in demo mode: there's nothing for the browser to PUT to. */
  sessionUri: string | null;
};

/**
 * Step 1 of the two-step protocol. Runs every validation that used to happen in the old
 * whole-file server action — allowed extension/size, per-day rate limit, bookId ownership — up
 * front, before Drive is ever contacted. Only after all of that passes does it ensure the Drive
 * folder tree, open a resumable session, and insert the "pending" row.
 */
export async function createUploadSessionForUser(userId: string, input: CreateUploadSessionInput): Promise<UploadSessionResult> {
  await expirePendingUploadsForUser(userId);

  if ((await countUploadsToday(userId)) >= UPLOAD_MAX_PER_DAY) {
    throw new UploadError(`You've reached today's limit of ${UPLOAD_MAX_PER_DAY} uploads. Please try again tomorrow.`);
  }

  let bookTitle: string | null = null;
  if (input.bookId) {
    const owned = (await listBooksForUser(userId)).find((b) => b.id === input.bookId);
    if (!owned) throw new UploadError("That book isn't associated with your account.");
    bookTitle = owned.title;
  }

  const demo = isDemoMode();
  const { mimeType } = validateUploadMeta(
    { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    { maxBytes: demo ? DEMO_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES },
  );
  const fileName = sanitizeFilename(input.fileName || "upload");
  const note = input.note?.trim() || null;
  const user = await getUserRow(userId);

  if (demo) {
    // Demo mode never touches Google: no service account is configured, and per the brief, no
    // bytes should be sent anywhere even to our own server. The row starts "pending" just like
    // the real flow and is flipped to "demo" by completeUploadForUser below.
    const [row] = await db
      .insert(authorUploads)
      .values({
        userId,
        bookId: input.bookId || null,
        driveFileId: `pending-${randomUUID()}`,
        driveFolderId: null,
        driveWebViewLink: null,
        fileName,
        mimeType,
        sizeBytes: input.sizeBytes,
        kind: input.kind,
        note,
        status: PENDING,
      })
      .returning();
    return { uploadId: row.id, sessionUri: null };
  }

  if (!isUploadsConfigured() || !env.GOOGLE_UPLOADS_ROOT_FOLDER_ID) {
    throw new UploadError("Uploads aren't set up yet. Please contact your Author Manager.");
  }

  const rootFolderId = env.GOOGLE_UPLOADS_ROOT_FOLDER_ID;
  const authorName = user.name?.trim() || user.email;
  const authorFolderName = sanitizeFilename(`${authorName} (${user.hubspotContactId ?? user.id})`);
  const bookFolderName = sanitizeFilename(bookTitle ?? "General");

  let bookFolderId: string;
  let sessionUri: string;
  try {
    const authorFolderId = await ensureFolder(rootFolderId, authorFolderName);
    bookFolderId = await ensureFolder(authorFolderId, bookFolderName);
    sessionUri = await createResumableSession({ folderId: bookFolderId, name: fileName, mimeType, sizeBytes: input.sizeBytes });
  } catch (err) {
    await audit(userId, "author.upload.failed", {
      targetType: "author_upload",
      meta: { fileName, error: err instanceof Error ? err.message : String(err) },
    });
    throw new UploadError("We couldn't start that upload just now. Please try again in a moment.");
  }

  const [row] = await db
    .insert(authorUploads)
    .values({
      userId,
      bookId: input.bookId || null,
      driveFileId: `pending-${randomUUID()}`,
      driveFolderId: bookFolderId,
      driveWebViewLink: null,
      fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      kind: input.kind,
      note,
      status: PENDING,
    })
    .returning();

  return { uploadId: row.id, sessionUri };
}

export type CompleteUploadInput = {
  uploadId: string;
  /** The id the browser read out of the final resumable PUT's JSON body. Required for a real
   *  (non-demo) upload; ignored in demo mode, where nothing was ever sent to Drive. */
  driveFileId?: string | null;
};

/** Step 2: called once the browser's direct-to-Drive PUT has finished. Verifies the row belongs
 *  to `userId` and is still "pending", confirms with Drive what landed, and flips the row to
 *  "stored" (or "demo"). Notifies staff and audits on success, same as the old single-step flow. */
export async function completeUploadForUser(userId: string, input: CompleteUploadInput): Promise<AuthorUpload> {
  const [row] = await db
    .select()
    .from(authorUploads)
    .where(and(eq(authorUploads.id, input.uploadId), eq(authorUploads.userId, userId)))
    .limit(1);
  if (!row) throw new UploadError("We couldn't find that upload.");

  if (row.status !== PENDING) {
    if (row.status === "failed") throw new UploadError("That upload session expired. Please try sending the file again.");
    // Already completed by an earlier call (e.g. a retried request) — treat as a no-op success.
    return row;
  }

  const demo = isDemoMode();
  const user = await getUserRow(userId);
  const authorName = user.name?.trim() || user.email;
  const bookTitle = row.bookId ? ((await listBooksForUser(userId)).find((b) => b.id === row.bookId)?.title ?? null) : null;

  if (demo) {
    const [updated] = await db
      .update(authorUploads)
      .set({ status: "demo", driveFileId: `demo-${randomUUID()}` })
      .where(eq(authorUploads.id, row.id))
      .returning();
    await audit(userId, "author.upload", {
      targetType: "author_upload",
      targetId: row.id,
      meta: { fileName: row.fileName, sizeBytes: row.sizeBytes, kind: row.kind, bookId: row.bookId, status: "demo" },
    });
    return updated;
  }

  if (!input.driveFileId) throw new UploadError("Missing the uploaded file's id.");

  let finalized: Awaited<ReturnType<typeof finalizeUploadedFile>>;
  try {
    finalized = await finalizeUploadedFile(input.driveFileId);
  } catch (err) {
    await markUploadFailed(row, userId, err);
    throw new UploadError("We couldn't confirm that file arrived. Please try sending it again.");
  }

  if (finalized.size != null && finalized.size !== row.sizeBytes) {
    await markUploadFailed(row, userId, new Error(`size mismatch: expected ${row.sizeBytes}, got ${finalized.size}`));
    throw new UploadError("That file didn't arrive completely. Please try sending it again.");
  }

  const [updated] = await db
    .update(authorUploads)
    .set({ status: "stored", driveFileId: finalized.id, driveWebViewLink: finalized.webViewLink })
    .where(eq(authorUploads.id, row.id))
    .returning();

  await audit(userId, "author.upload", {
    targetType: "author_upload",
    targetId: row.id,
    meta: { fileName: row.fileName, sizeBytes: row.sizeBytes, kind: row.kind, bookId: row.bookId, status: "stored" },
  });

  if (env.RESEND_API_KEY && env.UPLOADS_NOTIFY_EMAIL) {
    try {
      await sendUploadNotificationEmail(env.UPLOADS_NOTIFY_EMAIL, {
        authorName,
        bookTitle,
        fileName: row.fileName,
        sizeBytes: row.sizeBytes,
        driveWebViewLink: finalized.webViewLink,
      });
    } catch {
      // Notification is best-effort — the file is already safely stored and audited, so a
      // failed email must not fail the upload for the author.
    }
  }

  return updated;
}

async function markUploadFailed(row: AuthorUpload, userId: string, err: unknown): Promise<void> {
  await db.update(authorUploads).set({ status: "failed" }).where(eq(authorUploads.id, row.id));
  await audit(userId, "author.upload.failed", {
    targetType: "author_upload",
    targetId: row.id,
    meta: { fileName: row.fileName, error: err instanceof Error ? err.message : String(err) },
  });
}
