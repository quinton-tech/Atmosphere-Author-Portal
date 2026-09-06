import "server-only";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { DriveFile, DriveReader } from "./client";

/**
 * Credential-free `DriveReader` for demo mode (`isDemoMode()` in `src/lib/env.ts`). Serves fixed
 * files from `public/demo/` instead of calling Google Drive, so a preview deploy needs no service
 * account. Swapped in by `getDriveReader()` in `./client.ts`; nothing else should import this
 * module directly.
 *
 * Shape mirrors the real whole-folder Drive model (see `src/lib/data/files.ts`): one AUTHOR
 * folder (`AUTHOR_FOLDER_ID`, value "demo-author-folder" — matches `DEMO_AUTHOR_FOLDER_ID` in
 * `src/db/demo-data.ts`, which `seed-demo.ts`'s `linkDemoAuthorFolder` writes onto
 * `users.driveFolderId`) with its own files, containing one BOOK subfolder (`DEMO_FOLDER_ID`,
 * named after the demo book so title-matching in `files.ts` finds it on its own even without the
 * `books.driveFolderId` override, which `demo-data.ts`'s `DEMO_BOOK_1` also sets to this id
 * belt-and-braces) with copies of the same two fixture files.
 *
 * File ids: `demo-cover`/`demo-blurb` (the original ids, kept stable) live in the BOOK subfolder
 * — `demo-data.ts`'s `DEMO_FILE_OVERRIDES` relabels `demo-cover` and its own comment describes it
 * as "book 1's two fixture files". The author ROOT folder gets its own distinct pair,
 * `demo-root-cover`/`demo-root-blurb`, so both groups have content without id collisions.
 */

export const AUTHOR_FOLDER_ID = "demo-author-folder";
export const DEMO_FOLDER_ID = "demo-folder";
export const DEMO_BOOK_TITLE = "The Orchard at Dusk";

const DEMO_DIR = path.join(process.cwd(), "public", "demo");

type FixtureFile = {
  id: string;
  name: string;
  mimeType: string;
  filename: string; // relative to public/demo/ — may be shared by more than one fixture file id
};

// Author root folder's own files (not tied to any one book).
const ROOT_FILES: FixtureFile[] = [
  { id: "demo-root-cover", name: "Author headshot.svg", mimeType: "image/svg+xml", filename: "cover.svg" },
  { id: "demo-root-blurb", name: "Author bio.pdf", mimeType: "application/pdf", filename: "blurb.pdf" },
];

// Book subfolder files — original fixture ids, referenced by `demo-data.ts`'s DEMO_FILE_OVERRIDES.
const BOOK_FILES: FixtureFile[] = [
  { id: "demo-cover", name: "Final cover.svg", mimeType: "image/svg+xml", filename: "cover.svg" },
  { id: "demo-blurb", name: "Back-cover blurb.pdf", mimeType: "application/pdf", filename: "blurb.pdf" },
];

const ALL_FILES = [...ROOT_FILES, ...BOOK_FILES];
const byId = new Map(ALL_FILES.map((f) => [f.id, f]));
const THUMBNAIL_ELIGIBLE_IDS = new Set(["demo-root-cover", "demo-cover"]);

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
    thumbnailLink: THUMBNAIL_ELIGIBLE_IDS.has(f.id) ? `fixture://${f.id}` : null,
    iconLink: null,
    isFolder: false,
  };
}

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function folder(id: string, name: string): DriveFile {
  return { id, name, mimeType: FOLDER_MIME_TYPE, size: null, modifiedTime: null, thumbnailLink: null, iconLink: null, isFolder: true };
}

const AUTHOR_FOLDER = folder(AUTHOR_FOLDER_ID, "Demo Author");
const BOOK_FOLDER = folder(DEMO_FOLDER_ID, DEMO_BOOK_TITLE);

export class FixtureDriveReader implements DriveReader {
  async listFolder(folderId: string): Promise<DriveFile[]> {
    if (folderId === AUTHOR_FOLDER_ID) return [...ROOT_FILES.map(toDriveFile), BOOK_FOLDER];
    if (folderId === DEMO_FOLDER_ID) return BOOK_FILES.map(toDriveFile);
    return [];
  }

  async searchFolders(query: string, rootId?: string): Promise<DriveFile[]> {
    if (rootId && rootId !== AUTHOR_FOLDER_ID) return [];
    const needle = query.trim().toLowerCase();
    const candidates = [AUTHOR_FOLDER, BOOK_FOLDER];
    return needle ? candidates.filter((f) => f.name.toLowerCase().includes(needle)) : candidates;
  }

  async getFile(fileId: string): Promise<DriveFile | null> {
    if (fileId === AUTHOR_FOLDER_ID) return AUTHOR_FOLDER;
    if (fileId === DEMO_FOLDER_ID) return BOOK_FOLDER;
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
    if (!THUMBNAIL_ELIGIBLE_IDS.has(fileId)) return null;
    const cover = byId.get(fileId);
    if (!cover) return null;
    const bytes = await readFile(path.join(DEMO_DIR, cover.filename));
    return { bytes: new Uint8Array(bytes), mimeType: cover.mimeType };
  }
}
