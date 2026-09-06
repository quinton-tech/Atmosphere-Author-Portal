import "server-only";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { env } from "@/lib/env";

/**
 * THE ONLY PLACE THAT WRITES TO GOOGLE DRIVE.
 *
 * CLAUDE.md's hard rule is "Drive is READ ONLY" with one approved exception: authors sending us
 * files (manuscripts, signed forms) via `/uploads`. That flow is served entirely by this module,
 * which builds its own JWT client from a SEPARATE service account credential
 * (`GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64`) scoped to `drive.file` only — that scope means the
 * credential can see/create/update only files and folders IT created, never the read-only tree
 * `src/lib/drive/client.ts` reads from. Nothing else in the codebase may call a Drive mutating
 * method; `uploads.guard.test.ts` fails the build otherwise.
 */

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

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

let driveClient: drive_v3.Drive | null = null;

function client(): drive_v3.Drive {
  if (!driveClient) {
    const creds = decodeUploadsServiceAccountCredentials();
    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [DRIVE_FILE_SCOPE],
    });
    driveClient = google.drive({ version: "v3", auth: jwt });
  }
  return driveClient;
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

/** Uploads one file's bytes into `folderId`. Returns the new file's id and staff-facing link. */
export async function uploadFile(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ id: string; webViewLink: string | null }> {
  const drive = client();
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.folderId] },
    media: { mimeType: opts.mimeType, body: Readable.from(opts.bytes) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error(`Drive did not return an id for file "${opts.name}"`);
  return { id: res.data.id, webViewLink: res.data.webViewLink ?? null };
}
