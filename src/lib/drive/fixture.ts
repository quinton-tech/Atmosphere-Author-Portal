import "server-only";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { DriveFile, DriveReader } from "./client";

/**
 * Credential-free `DriveReader` for demo mode (`isDemoMode()` in `src/lib/env.ts`). Serves a
 * fixed pair of files from `public/demo/` instead of calling Google Drive, so a preview deploy
 * needs no service account. Swapped in by `getDriveReader()` in `./client.ts`; nothing else
 * should import this module directly. See `src/db/demo-data.ts` for the matching seed data
 * (book 1's `driveFolderId` is `DEMO_FOLDER_ID` and its `visible_files` rows point at these ids).
 */

export const DEMO_FOLDER_ID = "demo-folder";

const DEMO_DIR = path.join(process.cwd(), "public", "demo");

type FixtureFile = {
  id: string;
  name: string;
  mimeType: string;
  filename: string; // relative to public/demo/
};

const FIXTURE_FILES: FixtureFile[] = [
  { id: "demo-cover", name: "Final cover.svg", mimeType: "image/svg+xml", filename: "cover.svg" },
  { id: "demo-blurb", name: "Back-cover blurb.pdf", mimeType: "application/pdf", filename: "blurb.pdf" },
];

const byId = new Map(FIXTURE_FILES.map((f) => [f.id, f]));

function toDriveFile(f: FixtureFile): DriveFile {
  let size: number | null = null;
  let modifiedTime: string | null = null;
  try {
    const stat = statSync(path.join(DEMO_DIR, f.filename));
    size = stat.size;
    modifiedTime = stat.mtime.toISOString();
  } catch {
    // Fixture asset missing on disk; still describe the file, just without size/mtime.
  }
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size,
    modifiedTime,
    thumbnailLink: f.id === "demo-cover" ? `fixture://${f.id}` : null,
    iconLink: null,
    isFolder: false,
  };
}

const DEMO_FOLDER: DriveFile = {
  id: DEMO_FOLDER_ID,
  name: "Demo Book Folder",
  mimeType: "application/vnd.google-apps.folder",
  size: null,
  modifiedTime: null,
  thumbnailLink: null,
  iconLink: null,
  isFolder: true,
};

export class FixtureDriveReader implements DriveReader {
  async listFolder(folderId: string): Promise<DriveFile[]> {
    if (folderId !== DEMO_FOLDER_ID) return [];
    return FIXTURE_FILES.map(toDriveFile);
  }

  async searchFolders(query: string, rootId?: string): Promise<DriveFile[]> {
    if (rootId && rootId !== DEMO_FOLDER_ID) return [];
    const needle = query.trim().toLowerCase();
    if (needle && !DEMO_FOLDER.name.toLowerCase().includes(needle)) return [];
    return [DEMO_FOLDER];
  }

  async getFile(fileId: string): Promise<DriveFile | null> {
    if (fileId === DEMO_FOLDER_ID) return DEMO_FOLDER;
    const f = byId.get(fileId);
    return f ? toDriveFile(f) : null;
  }

  async stream(fileId: string): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; size?: number; name: string }> {
    const f = byId.get(fileId);
    if (!f) throw new Error("File not found");
    const bytes = await readFile(path.join(DEMO_DIR, f.filename));
    const body = new Uint8Array(bytes);
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
      mimeType: f.mimeType,
      size: body.byteLength,
      name: f.name,
    };
  }

  async thumbnail(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (fileId !== "demo-cover") return null;
    const cover = byId.get("demo-cover");
    if (!cover) return null;
    const bytes = await readFile(path.join(DEMO_DIR, cover.filename));
    return { bytes: new Uint8Array(bytes), mimeType: cover.mimeType };
  }
}
