/**
 * Pure helpers for turning raw Drive listings into the author-facing `DriveFileView` /
 * `DriveFolderGroup` shapes (src/lib/types.ts). No Drive/db/"server-only" deps here — the
 * orchestration (caching, DB overrides, the actual `listFolder` calls) lives in
 * `src/lib/data/files.ts`. Keeping this pure is what makes title<->folder matching, category
 * inference, and override application unit-testable without a database.
 */
import type { DriveFile } from "./client";
import type { DriveFileView } from "@/lib/types";

/** Lowercase, punctuation stripped to spaces, whitespace collapsed. Empty string for empty input. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when a Drive subfolder's name plausibly refers to a book's title: after normalising both
 * (lowercase, punctuation stripped), one contains the other. Empty normalised strings never match
 * (an empty title or folder name isn't a signal of anything).
 */
export function titleFolderMatch(folderName: string, bookTitle: string): boolean {
  const a = normalizeTitle(folderName);
  const b = normalizeTitle(bookTitle);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Given a folder name and the author's books, find the one whose title matches, if any. */
export function matchBookByTitle<T extends { id: string; title: string }>(folderName: string, books: T[]): T | null {
  return books.find((b) => titleFolderMatch(folderName, b.title)) ?? null;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/blurb|back.?cover|synopsis/i, "Blurb"],
  [/cover/i, "Cover"],
  [/proof/i, "Proof"],
  [/manuscript|\.docx?$/i, "Manuscript"],
];

/** Infers a display category from a Drive file's name when no staff override exists. */
export function inferCategory(name: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "Other";
}

/** File name with its extension stripped, used as the default label. */
export function labelFromName(name: string): string {
  const idx = name.lastIndexOf(".");
  // Don't strip a leading dot (dotfile) or treat "no extension" as one.
  return idx > 0 ? name.slice(0, idx) : name;
}

export function isThumbnailEligible(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

/** Staff override on a single file (subset of the `visible_files` row this cares about). */
export type FileOverride = {
  hidden: boolean;
  label: string;
  category: string;
};

/**
 * Builds the author-facing view of one Drive file, applying a staff override (if any) and
 * inferring label/category when there isn't one. Returns null when the override hides the file.
 */
export function buildDriveFileView(file: DriveFile, folderPath: string[], override: FileOverride | null | undefined): DriveFileView | null {
  if (override?.hidden) return null;
  const label = override?.label?.trim() || labelFromName(file.name);
  const category = override?.category?.trim() || inferCategory(file.name);
  const thumbnailHref = isThumbnailEligible(file.mimeType) ? `/api/files/d/${file.id}/thumbnail` : null;
  return {
    id: file.id,
    name: file.name,
    label,
    category,
    mimeType: file.mimeType,
    size: file.size,
    modifiedAt: file.modifiedTime,
    href: `/api/files/d/${file.id}`,
    downloadHref: `/api/files/d/${file.id}?download=1`,
    thumbnailHref,
    folderPath,
  };
}
