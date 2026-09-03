import "server-only";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { JWT } from "google-auth-library";
import { env, isDemoMode } from "@/lib/env";
import { FixtureDriveReader } from "./fixture";
import { GOOGLE_EXPORT_MIME_TYPE, isGoogleExportableMimeType } from "./mime";

/**
 * Read-only Google Drive access via a service account. Nothing in this file (or anywhere else
 * in src/lib/drive) may call a Drive write method — the JWT is scoped to drive.readonly, which
 * makes writes fail server-side even if one slipped in.
 */

const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null; // ISO
  thumbnailLink: string | null;
  iconLink: string | null;
  isFolder: boolean;
};

export interface DriveReader {
  /** Files and subfolders directly inside `folderId`. */
  listFolder(folderId: string): Promise<DriveFile[]>;
  /** For the admin folder picker: folders whose name contains `query`, optionally under `rootId`. */
  searchFolders(query: string, rootId?: string): Promise<DriveFile[]>;
  getFile(fileId: string): Promise<DriveFile | null>;
  /** alt=media for regular files; Google Docs-family files are exported to PDF. */
  stream(fileId: string): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; size?: number; name: string }>;
  /** Fetches thumbnailLink server-side (it requires a credentialed request) and returns raw bytes. */
  thumbnail(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

function isNotFoundError(err: unknown): boolean {
  const status =
    (err as { response?: { status?: number } } | undefined)?.response?.status ??
    (err as { code?: number | string } | undefined)?.code;
  return status === 404 || status === "404";
}

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "Untitled",
    mimeType: f.mimeType ?? "application/octet-stream",
    size: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    thumbnailLink: f.thumbnailLink ?? null,
    iconLink: f.iconLink ?? null,
    isFolder: f.mimeType === FOLDER_MIME_TYPE,
  };
}

/** Escapes a value for use inside a single-quoted Drive `q` clause. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function decodeServiceAccountCredentials(): { client_email: string; private_key: string } {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not configured");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not valid base64-encoded JSON");
  }
  const creds = parsed as { client_email?: string; private_key?: string };
  if (!creds.client_email || !creds.private_key) {
    throw new Error("Service account JSON is missing client_email or private_key");
  }
  return { client_email: creds.client_email, private_key: creds.private_key };
}

class ServiceAccountDriveReader implements DriveReader {
  private driveClient: drive_v3.Drive | null = null;
  private jwtClient: JWT | null = null;

  private client(): { drive: drive_v3.Drive; jwt: JWT } {
    if (!this.driveClient || !this.jwtClient) {
      const creds = decodeServiceAccountCredentials();
      const jwt = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: [DRIVE_READONLY_SCOPE],
      });
      this.jwtClient = jwt;
      this.driveClient = google.drive({ version: "v3", auth: jwt });
    }
    return { drive: this.driveClient, jwt: this.jwtClient };
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    const { drive } = this.client();
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: 1000,
        pageToken,
        orderBy: "folder,name_natural",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) out.push(toDriveFile(f));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async searchFolders(query: string, rootId?: string): Promise<DriveFile[]> {
    const { drive } = this.client();
    const clauses = [
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
      `name contains '${escapeDriveQueryValue(query)}'`,
    ];
    if (rootId) clauses.push(`'${escapeDriveQueryValue(rootId)}' in parents`);
    const res = await drive.files.list({
      q: clauses.join(" and "),
      fields: `files(${FILE_FIELDS})`,
      pageSize: 50,
      orderBy: "name_natural",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (res.data.files ?? []).map(toDriveFile);
  }

  async getFile(fileId: string): Promise<DriveFile | null> {
    const { drive } = this.client();
    try {
      const res = await drive.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
      return toDriveFile(res.data);
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async stream(fileId: string): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; size?: number; name: string }> {
    const { drive } = this.client();
    const meta = await this.getFile(fileId);
    if (!meta) throw new Error("File not found");

    if (isGoogleExportableMimeType(meta.mimeType)) {
      const res = await drive.files.export({ fileId, mimeType: GOOGLE_EXPORT_MIME_TYPE }, { responseType: "stream" });
      const nodeStream = res.data as unknown as Readable;
      return {
        stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
        mimeType: GOOGLE_EXPORT_MIME_TYPE,
        name: meta.name,
      };
    }

    const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    const nodeStream = res.data as unknown as Readable;
    return {
      stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      mimeType: meta.mimeType,
      size: meta.size ?? undefined,
      name: meta.name,
    };
  }

  async thumbnail(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const { jwt } = this.client();
    const meta = await this.getFile(fileId);
    if (!meta?.thumbnailLink) return null;
    const { token } = await jwt.getAccessToken();
    if (!token) return null;
    const res = await fetch(meta.thumbnailLink, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { bytes, mimeType };
  }
}

let singleton: DriveReader | null = null;

/**
 * Lazily-constructed, process-wide DriveReader. In demo mode (`isDemoMode()`) this returns the
 * credential-free `FixtureDriveReader` (`./fixture.ts`) instead, so a preview deploy needs no
 * Google service account. Otherwise throws if the service account env var is unset.
 */
export function getDriveReader(): DriveReader {
  if (!singleton) singleton = isDemoMode() ? new FixtureDriveReader() : new ServiceAccountDriveReader();
  return singleton;
}
