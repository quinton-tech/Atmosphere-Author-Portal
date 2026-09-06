import "server-only";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { JWT } from "google-auth-library";
import { env } from "@/lib/env";

/**
 * THE ONLY PLACE THAT WRITES TO GOOGLE DRIVE.
 *
 * CLAUDE.md's hard rule is "Drive is READ ONLY" with one approved exception: authors sending us
 * files (manuscripts, signed forms) via `/uploads`, and admins uploading the Author Handbook via
 * `/admin/handbook`. Both flows are served entirely by this module, which builds its own JWT
 * client from a SEPARATE service account credential (`GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64`)
 * scoped to `drive.file` only — that scope means the credential can see/create/update only files
 * and folders IT created, never the read-only tree `src/lib/drive/client.ts` reads from. Nothing
 * else in the codebase may call a Drive mutating method; `uploads.guard.test.ts` fails the build
 * otherwise.
 *
 * Uploads go straight from the author's/admin's browser to Drive via a *resumable session*
 * (`createResumableSession` below), never through a Vercel function — Vercel caps function
 * request bodies at 4.5MB regardless of any Next.js config
 * (https://vercel.com/docs/functions/limitations#request-body-size), which is well under the
 * 50MB/25MB this app advertises. `finalizeUploadedFile` and `downloadUploadedFile` then use the
 * ordinary Drive client (not raw fetch) to confirm what landed and, for the handbook, read it back.
 */

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const RESUMABLE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink";

function decodeUploadsServiceAccountCredentials(): { client_email: string; private_key: string } {
  if (!env.GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64) {
    throw new Error("GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64 is not configured");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(env.GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64 is not valid base64-encoded JSON");
  }
  const creds = parsed as { client_email?: string; private_key?: string };
  if (!creds.client_email || !creds.private_key) {
    throw new Error("Uploads service account JSON is missing client_email or private_key");
  }
  return { client_email: creds.client_email, private_key: creds.private_key };
}

/** Escapes a value for use inside a single-quoted Drive `q` clause. Duplicated from client.ts
 *  on purpose — this module must not import anything from the read-only DriveReader. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

let jwtClient: JWT | null = null;
let driveClient: drive_v3.Drive | null = null;

/** Lazily builds (and reuses) the drive.file-scoped JWT client. Exposed separately from
 *  `client()` because `createResumableSession` needs a bearer token for a raw `fetch`, not the
 *  typed `drive_v3.Drive` client — Google's resumable-session *initiation* has no method on the
 *  googleapis client library, only the classic REST shape. */
function auth(): JWT {
  if (!jwtClient) {
    const creds = decodeUploadsServiceAccountCredentials();
    jwtClient = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [DRIVE_FILE_SCOPE],
    });
  }
  return jwtClient;
}

function client(): drive_v3.Drive {
  if (!driveClient) {
    driveClient = google.drive({ version: "v3", auth: auth() });
  }
  return driveClient;
}

async function bearerToken(): Promise<string> {
  const { token } = await auth().getAccessToken();
  if (!token) throw new Error("Could not obtain an access token for the uploads service account");
  return token;
}

/**
 * Find-or-create a folder named `name` directly under `parentId`. Idempotent: a second call with
 * the same (parentId, name) reuses the existing folder rather than creating a duplicate.
 */
export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const drive = client();
  const q = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME_TYPE}'`,
    "trashed = false",
  ].join(" and ");

  const existing = await drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 1,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error(`Drive did not return an id for folder "${name}"`);
  return created.data.id;
}

/**
 * Opens a Google Drive resumable upload session for a file that will be PUT directly from the
 * browser — our server never sees the bytes. POSTs metadata only (name + parent folder) to
 * Drive's resumable-upload endpoint with `X-Upload-Content-Type`/`X-Upload-Content-Length` so
 * Drive knows what's coming, and returns the session URI from the `Location` response header.
 *
 * That URI is itself the credential for the subsequent PUT(s): it's single-use and expires after
 * a week (per Google's docs), so handing it to the browser is safe — it can't be replayed against
 * a different file or reused once the upload completes, and it carries no broader Drive access
 * than "finish this one upload".
 */
export async function createResumableSession(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<string> {
  const token = await bearerToken();
  const res = await fetch(RESUMABLE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mimeType,
      "X-Upload-Content-Length": String(opts.sizeBytes),
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.folderId] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive did not accept the resumable session (${res.status}): ${body.slice(0, 300)}`);
  }
  const location = res.headers.get("Location") ?? res.headers.get("location");
  if (!location) throw new Error("Drive did not return a resumable session URI");
  return location;
}

/** Confirms what actually landed after the browser's direct PUT(s) finished, keyed by the file id
 *  the browser read out of the final PUT's JSON response body. */
export async function finalizeUploadedFile(fileId: string): Promise<{
  id: string;
  webViewLink: string | null;
  size: number | null;
  mimeType: string | null;
  md5Checksum: string | null;
}> {
  const drive = client();
  const res = await drive.files.get({
    fileId,
    fields: "id,webViewLink,size,mimeType,md5Checksum",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error(`Drive has no record of file "${fileId}"`);
  return {
    id: res.data.id,
    webViewLink: res.data.webViewLink ?? null,
    size: res.data.size != null ? Number(res.data.size) : null,
    mimeType: res.data.mimeType ?? null,
    md5Checksum: res.data.md5Checksum ?? null,
  };
}

/** Reads back the bytes of a file this credential created — used only for the handbook flow, to
 *  ingest the PDF/DOCX the admin just PUT to Drive. `alt: "media"` on a `drive.file`-scoped
 *  credential is fine for a file it created itself; it still can't read anything it didn't. */
export async function downloadUploadedFile(fileId: string): Promise<Buffer> {
  const drive = client();
  const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
