/**
 * Pure validation for author uploads — no db, no "server-only", no Drive/network deps — so it can
 * be unit-tested directly and shared by both `src/lib/data/uploads.ts` (server) and, indirectly,
 * the API route handlers under `src/app/api/uploads/`. Split out for the same reason
 * `src/lib/assistant/handbook-text.ts` was split from `handbook.ts`: importing anything that
 * pulls in "server-only" (via `@/db` or `@/lib/env`) throws outside Next's bundler, including
 * under plain vitest.
 */

/** User-safe error: message is shown directly to the author. */
export class UploadError extends Error {}

export const UPLOAD_KINDS = ["manuscript", "form", "other"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — real limit, enforced end to end now
// that bytes go straight to Drive (see CLAUDE.md / the hosting-limit fix in src/lib/drive/uploads.ts).
/** Demo mode has no Drive credentials and no direct-to-Drive path, so its fallback ceiling is the
 *  smallest amount we're confident survives any reasonable request path — see `isDemoMode()`. */
export const DEMO_MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

export const UPLOAD_MAX_PER_DAY = 20;

/** How long a session can sit in "pending" (browser never finished the PUT, or never called
 *  /api/uploads/complete) before the cron sweep (or the next session-creation call for that user)
 *  gives up on it and marks it "failed". */
export const PENDING_EXPIRY_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_EXTENSION_MIME: Record<string, string> = {
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

export function extensionOf(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

export type UploadMetaInput = { fileName: string; mimeType: string; sizeBytes: number };

/**
 * Validates upload metadata (extension, size) before Drive is ever contacted. Throws UploadError
 * with author-facing copy on any rejection. Returns the canonical mime type to store — derived
 * from the extension, same as before, never trusted from the browser's claimed `mimeType`.
 *
 * NOTE: this used to also sniff the file's first bytes against its claimed extension
 * (`matchesMagicBytes`, removed). That check needed the actual bytes in the server process; the
 * whole point of the direct-to-Drive resumable flow is that bytes never pass through our server,
 * so there's nothing left here to sniff. The remaining defenses — extension allow-list, a fixed
 * per-author Drive folder tree, a drive.file-scoped credential, and staff review at
 * /admin/uploads before anyone acts on a file — are judged an acceptable trade for not routing
 * every author upload through a Vercel function (which is what broke uploads >4.5MB in the first
 * place; see https://vercel.com/docs/functions/limitations#request-body-size).
 */
export function validateUploadMeta(input: UploadMetaInput, opts: { maxBytes: number }): { mimeType: string; extension: string } {
  const extension = extensionOf(input.fileName);
  if (!extension || !(extension in ALLOWED_EXTENSION_MIME)) {
    throw new UploadError(
      `We can't accept .${extension ?? "?"} files. Allowed types: ${Object.keys(ALLOWED_EXTENSION_MIME).join(", ")}.`,
    );
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadError("That file looks empty. Please choose a different file.");
  }
  if (input.sizeBytes > opts.maxBytes) {
    const label = `${Math.round(opts.maxBytes / (1024 * 1024))} MB`;
    throw new UploadError(`That file is larger than ${label}. Please send a smaller file, or ask your Author Manager for another way to share it.`);
  }
  return { mimeType: ALLOWED_EXTENSION_MIME[extension], extension };
}

/** Pure pending-expiry rule: true once `createdAt` is more than 24h in the past. Used both by the
 *  cron sweep (all users) and opportunistically on the next session-creation call for one user. */
export function isPendingExpired(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > PENDING_EXPIRY_MS;
}
