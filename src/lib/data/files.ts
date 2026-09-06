import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { books, users, visibleFiles } from "@/db/schema";
import { getDriveReader, type DriveFile, type DriveReader } from "@/lib/drive/client";
import { buildDriveFileView, matchBookByTitle, type FileOverride } from "@/lib/drive/files-view";
import type { AuthorFilesView, DriveFileView, DriveFolderGroup } from "@/lib/types";

/**
 * The Drive file model: one master folder -> one subfolder per author -> sub-subfolders per book
 * when the author has several. `users.driveFolderId` (parsed at sync time from HubSpot's
 * `gd_link_sync`, see hubspot/plan.ts) is the author's own folder. Authors see their WHOLE
 * folder by default; `visible_files` is now an OVERRIDES table (hide a file, or relabel/
 * recategorize it) rather than an allow-list — see CLAUDE.md.
 *
 * This module is the real path for the author file browser and the `/api/files/d/*` proxy.
 * `src/lib/data/books.ts` still exports `getVisibleFileForUser` for the older `/api/files/[id]`
 * routes (existing `visible_files` rows created before this model), but new code should go
 * through `getAuthorFiles`/`getDriveFileForUser` here.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DEPTH = 3; // root (author folder) -> subfolder (book) -> sub-subfolder (e.g. "From the author")

type CacheEntry = { entries: DriveFile[]; fetchedAt: number };

// Process-wide, in-memory. Deliberately not per-request: a serverless instance may serve many
// requests before recycling, and this cuts real Drive calls dramatically for a folder tree that
// changes rarely. Keyed by Drive folder id, so it's shared across authors/books for free.
const folderCache = new Map<string, CacheEntry>();

type ListResult = { entries: DriveFile[]; fetchedAt: number; error: string | null };

/**
 * Cached wrapper around `DriveReader.listFolder`. On a Drive error, falls back to a stale cache
 * entry if one exists (with `error` set so callers can surface "may be out of date"), otherwise
 * returns an empty listing with the error.
 */
async function cachedListFolder(reader: DriveReader, folderId: string): Promise<ListResult> {
  const now = Date.now();
  const cached = folderCache.get(folderId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { entries: cached.entries, fetchedAt: cached.fetchedAt, error: null };
  }
  try {
    const entries = await reader.listFolder(folderId);
    folderCache.set(folderId, { entries, fetchedAt: now });
    return { entries, fetchedAt: now, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (cached) return { entries: cached.entries, fetchedAt: cached.fetchedAt, error: message };
    return { entries: [], fetchedAt: now, error: message };
  }
}

type FolderNode = {
  id: string;
  name: string;
  path: string[]; // folder names from (but excluding) the author root down to this folder
  files: DriveFile[];
  children: FolderNode[];
};

type TreeResult = { root: FolderNode; error: string | null; listedAt: string };

/** Recursively lists `folderId` to MAX_DEPTH, via the shared 5-minute folder cache. */
async function buildFolderTree(
  reader: DriveReader,
  folderId: string,
  name: string,
  path: string[],
  depth: number,
): Promise<{ node: FolderNode; error: string | null; fetchedAt: number }> {
  const result = await cachedListFolder(reader, folderId);
  const files = result.entries.filter((e) => !e.isFolder);
  const folderEntries = result.entries.filter((e) => e.isFolder);

  let error = result.error;
  let children: FolderNode[] = [];
  if (depth < MAX_DEPTH) {
    const childResults = await Promise.all(folderEntries.map((f) => buildFolderTree(reader, f.id, f.name, [...path, f.name], depth + 1)));
    children = childResults.map((c) => c.node);
    error = error ?? childResults.find((c) => c.error)?.error ?? null;
  }

  return { node: { id: folderId, name, path, files, children }, error, fetchedAt: result.fetchedAt };
}

async function loadAuthorFolderTree(reader: DriveReader, rootFolderId: string): Promise<TreeResult> {
  const rootMeta = await reader.getFile(rootFolderId).catch(() => null);
  const { node, error, fetchedAt } = await buildFolderTree(reader, rootFolderId, rootMeta?.name ?? "Your files", [], 1);
  return { root: node, error, listedAt: new Date(fetchedAt).toISOString() };
}

function flattenNodes(node: FolderNode, out: FolderNode[] = []): FolderNode[] {
  out.push(node);
  for (const child of node.children) flattenNodes(child, out);
  return out;
}

type BookRow = { id: string; title: string; driveFolderId: string | null };

/** Which book (if any) a folder node should be attributed to: an explicit staff override
 *  (`books.driveFolderId`) wins outright; otherwise, only a direct subfolder of the author root
 *  (path length 1) is matched by normalised title — deeper folders (e.g. "From the author") are
 *  never title-matched, since they're not named after a book. */
function matchNodeToBook(node: FolderNode, bookRows: BookRow[]): string | null {
  const byFolderId = bookRows.find((b) => b.driveFolderId === node.id);
  if (byFolderId) return byFolderId.id;
  if (node.path.length !== 1) return null;
  return matchBookByTitle(node.name, bookRows)?.id ?? null;
}

async function loadOverridesForUser(userId: string): Promise<Map<string, FileOverride>> {
  const userBooks = await db.select({ id: books.id }).from(books).where(eq(books.userId, userId));
  if (userBooks.length === 0) return new Map();
  const rows = await db
    .select({ driveFileId: visibleFiles.driveFileId, label: visibleFiles.label, category: visibleFiles.category, hidden: visibleFiles.hidden })
    .from(visibleFiles)
    .where(inArray(visibleFiles.bookId, userBooks.map((b) => b.id)));
  const map = new Map<string, FileOverride>();
  for (const r of rows) map.set(r.driveFileId, { hidden: r.hidden, label: r.label, category: r.category });
  return map;
}

function nodeToGroup(node: FolderNode, bookId: string | null, overrides: Map<string, FileOverride>): DriveFolderGroup | null {
  const files: DriveFileView[] = [];
  for (const f of node.files) {
    const view = buildDriveFileView(f, node.path, overrides.get(f.id));
    if (view) files.push(view);
  }
  if (files.length === 0) return null; // skip folders that are empty after hiding
  return { folderId: node.id, name: node.name, path: node.path, bookId, files };
}

/**
 * The author-facing view of their whole Drive folder: the root's own files first, then one group
 * per subfolder (and sub-subfolder, to MAX_DEPTH), skipping any that end up empty after applying
 * staff overrides. `connected` reflects whether an author folder is known at all — independent of
 * whether this particular fetch succeeded (a transient Drive error doesn't mean "disconnected").
 */
export async function getAuthorFiles(userId: string): Promise<AuthorFilesView> {
  const [user] = await db.select({ driveFolderId: users.driveFolderId }).from(users).where(eq(users.id, userId)).limit(1);
  const rootFolderId = user?.driveFolderId ?? null;
  if (!rootFolderId) {
    return { connected: false, folderName: null, groups: [], listedAt: null, error: null };
  }

  const reader = getDriveReader();
  const [tree, bookRows, overrides] = await Promise.all([
    loadAuthorFolderTree(reader, rootFolderId),
    db.select({ id: books.id, title: books.title, driveFolderId: books.driveFolderId }).from(books).where(eq(books.userId, userId)),
    loadOverridesForUser(userId),
  ]);

  const nodes = flattenNodes(tree.root);
  const groups: DriveFolderGroup[] = [];
  for (const node of nodes) {
    const bookId = node.path.length === 0 ? null : matchNodeToBook(node, bookRows);
    const group = nodeToGroup(node, bookId, overrides);
    if (group) groups.push(group);
  }

  return {
    connected: true,
    folderName: tree.root.name,
    groups,
    listedAt: tree.listedAt,
    error: tree.error,
  };
}

/**
 * Ownership-scoped lookup of one Drive file by id, for the `/api/files/d/*` proxy. Never trusts
 * the file id alone — it must actually appear somewhere in this author's (cached/fresh) file
 * listing, which is itself already override-filtered (a hidden file can never be "found" here).
 */
export async function getDriveFileForUser(userId: string, fileId: string): Promise<{ file: DriveFileView; ownerFolderId: string } | null> {
  const authorFiles = await getAuthorFiles(userId);
  for (const group of authorFiles.groups) {
    const file = group.files.find((f) => f.id === fileId);
    if (file) return { file, ownerFolderId: group.folderId };
  }
  return null;
}

/**
 * Resolves where an author upload should land: `<author folder>/<matched book subfolder if
 * any>/From the author/` when the author has a known Drive folder, else null (caller falls back
 * to the portal-owned upload tree). Does not create anything itself — `ensureFolder` (the
 * uploads-scoped write path in drive/uploads.ts) does that; this only figures out the right
 * parent folder id using the same read-only listing/cache as the author's file browser.
 */
export async function resolveAuthorUploadParentFolder(userId: string, book: BookRow | null): Promise<string | null> {
  const [user] = await db.select({ driveFolderId: users.driveFolderId }).from(users).where(eq(users.id, userId)).limit(1);
  const rootFolderId = user?.driveFolderId ?? null;
  if (!rootFolderId) return null;
  if (!book) return rootFolderId;
  if (book.driveFolderId) return book.driveFolderId; // staff already pinned an exact subfolder

  const reader = getDriveReader();
  const { entries } = await cachedListFolder(reader, rootFolderId);
  const match = entries.find((e) => e.isFolder && matchBookByTitle(e.name, [{ id: book.id, title: book.title }]));
  return match?.id ?? rootFolderId;
}
