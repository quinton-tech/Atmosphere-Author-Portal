import { getAuthorFiles } from "@/lib/data/files";
import type { VisibleFile } from "@/db/schema";
import type { DriveFolderGroup } from "@/lib/types";
import { env } from "@/lib/env";
import { getDriveReader, type DriveFile } from "../../_integrations";
import { linkFolderAction, upsertFileOverrideAction } from "./actions";
import { listFileOverridesForAuthor } from "./queries";
import { Badge, Card, PillButton, Table, Td, Th } from "../../_components/ui";

/**
 * Folder browser for one author's whole Drive tree (master folder → one subfolder per author →
 * sub-subfolders per book, see CLAUDE.md). Replaces the old per-book tick-to-show checklist:
 * authors see everything in their folder by default, so this is Hide/Show + relabel/recategorize,
 * not an opt-in allowlist. `visible_files` overrides are still stored per book, so a group not
 * matched to a specific book (the root author folder, or an unmatched subfolder) posts its
 * overrides against `fallbackBookId` (the book currently selected in the tabs above).
 */
export async function DrivePanel({
  userId,
  fallbackBookId,
  fallbackBookTitle,
  bookIds,
  driveFolderId,
  searchQuery,
}: {
  userId: string;
  fallbackBookId: string;
  fallbackBookTitle: string;
  /** Every book id belonging to this author — used to look up raw override rows across all of them. */
  bookIds: string[];
  /** The *selected* book's own driveFolderId override (a book-subfolder link), if staff set one. */
  driveFolderId: string | null;
  searchQuery?: string;
}) {
  const [filesView, overrides] = await Promise.all([getAuthorFiles(userId), listFileOverridesForAuthor(bookIds)]);

  return (
    <div className="space-y-6">
      <Card>
        <p className="eyebrow mb-1">Author folder (from HubSpot GD Link)</p>
        {filesView.connected ? (
          <p className="text-sm text-ink-2">{filesView.folderName ?? "Connected."}</p>
        ) : (
          <p className="text-sm text-muted">Not connected: no GD Link on any of this author&rsquo;s projects.</p>
        )}
      </Card>

      <div>
        <p className="eyebrow mb-2">Set a different folder for &ldquo;{fallbackBookTitle}&rdquo;</p>
        <p className="mb-3 text-sm text-ink-2">
          Subfolder override for this book:{" "}
          {driveFolderId ? (
            <span className="font-mono text-xs">{driveFolderId}</span>
          ) : (
            <span className="text-muted">none — uses the author folder above.</span>
          )}
        </p>

        <form className="flex gap-2" action={`/admin/authors/${userId}`}>
          <input type="hidden" name="bookId" value={fallbackBookId} />
          <input
            type="search"
            name="driveQuery"
            defaultValue={searchQuery ?? ""}
            placeholder="Search Drive folders by name…"
            className="w-72 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
          />
          <PillButton>Search</PillButton>
        </form>

        {searchQuery ? <FolderSearchResults userId={userId} bookId={fallbackBookId} query={searchQuery} /> : null}
      </div>

      {!filesView.connected ? null : filesView.error && filesView.groups.length === 0 ? (
        <p className="text-sm text-bad">{filesView.error}</p>
      ) : filesView.groups.length === 0 ? (
        <p className="text-sm text-muted">This author&rsquo;s folder has no files.</p>
      ) : (
        <div className="space-y-8">
          {filesView.error ? (
            <p className="text-sm text-muted">
              Couldn&rsquo;t reach Google Drive just now — showing files from {filesView.listedAt ?? "the last successful check"}.
            </p>
          ) : null}
          {filesView.groups.map((group) => (
            <FileOverrideTable
              key={group.folderId}
              userId={userId}
              group={group}
              targetBookId={group.bookId ?? fallbackBookId}
              overrides={overrides}
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchFolderSearch(query: string): Promise<{ results: DriveFile[] } | { error: string }> {
  try {
    const results = await getDriveReader().searchFolders(query, env.GOOGLE_DRIVE_ROOT_FOLDER_ID || undefined);
    return { results };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Drive search failed." };
  }
}

async function FolderSearchResults({ userId, bookId, query }: { userId: string; bookId: string; query: string }) {
  const outcome = await fetchFolderSearch(query);
  if ("error" in outcome) return <p className="text-sm text-bad">{outcome.error}</p>;
  if (outcome.results.length === 0) return <p className="text-sm text-muted">No folders matched &ldquo;{query}&rdquo;.</p>;
  return (
    <ul className="mt-3 space-y-1">
      {outcome.results.map((f) => (
        <li key={f.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
          <span>{f.name}</span>
          <form action={linkFolderAction.bind(null, userId, bookId, f.id)}>
            <PillButton>Link this folder</PillButton>
          </form>
        </li>
      ))}
    </ul>
  );
}

/** One folder's files, each with a Hide/Show toggle and inline label/category override inputs. */
function FileOverrideTable({
  userId,
  group,
  targetBookId,
  overrides,
}: {
  userId: string;
  group: DriveFolderGroup;
  targetBookId: string;
  overrides: Map<string, VisibleFile>;
}) {
  // The root group (the author's own folder, not a subfolder) has an empty `path`.
  const heading = group.path.length === 0 ? "Author folder" : group.name;
  return (
    <div>
      <p className="eyebrow mb-2">
        {heading}
        {group.bookId ? null : <span className="ml-2 font-normal normal-case text-muted">(not matched to a book)</span>}
      </p>
      {group.files.length === 0 ? (
        <p className="text-sm text-muted">No files in this folder.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Hide / relabel / recategorize</Th>
            </tr>
          </thead>
          <tbody>
            {group.files.map((f) => {
              const raw = overrides.get(`${targetBookId}:${f.id}`);
              return (
                <tr key={f.id}>
                  <Td>
                    {f.name} <Badge>{f.mimeType}</Badge>
                  </Td>
                  <Td>
                    <form
                      action={upsertFileOverrideAction.bind(null, userId, targetBookId, f.id)}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="hidden" defaultChecked={raw?.hidden ?? false} /> Hide from author
                      </label>
                      <input
                        name="label"
                        defaultValue={raw?.label ?? ""}
                        placeholder={f.label}
                        className="w-40 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                      />
                      <input
                        name="category"
                        defaultValue={raw?.category ?? ""}
                        placeholder={f.category}
                        className="w-32 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                      />
                      <PillButton>Save</PillButton>
                    </form>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
