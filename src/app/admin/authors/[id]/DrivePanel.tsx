import { getDriveReader, listFolderForAdmin, type AdminDriveFile, type DriveFile } from "../../_integrations";
import { linkFolderAction, setFileVisibilityAction } from "./actions";
import { env } from "@/lib/env";
import { Badge, PillButton, Table, Td, Th } from "../../_components/ui";

export async function DrivePanel({
  userId,
  bookId,
  driveFolderId,
  searchQuery,
}: {
  userId: string;
  bookId: string;
  driveFolderId: string | null;
  searchQuery?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2">Linked folder</p>
        <p className="mb-3 text-sm text-ink-2">
          {driveFolderId ? (
            <span className="font-mono text-xs">{driveFolderId}</span>
          ) : (
            <span className="text-muted">No Drive folder linked yet.</span>
          )}
        </p>

        <form className="flex gap-2" action={`/admin/authors/${userId}`}>
          <input type="hidden" name="bookId" value={bookId} />
          <input
            type="search"
            name="driveQuery"
            defaultValue={searchQuery ?? ""}
            placeholder="Search Drive folders by name…"
            className="w-72 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
          />
          <PillButton>Search</PillButton>
        </form>
      </div>

      {searchQuery ? <FolderSearchResults userId={userId} bookId={bookId} query={searchQuery} /> : null}

      {driveFolderId ? <FileVisibilityChecklist userId={userId} bookId={bookId} folderId={driveFolderId} /> : null}
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
    <ul className="space-y-1">
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

async function fetchFolderFiles(folderId: string, bookId: string): Promise<{ files: AdminDriveFile[] } | { error: string }> {
  try {
    const files = await listFolderForAdmin(folderId, bookId);
    return { files };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not list Drive folder." };
  }
}

async function FileVisibilityChecklist({ userId, bookId, folderId }: { userId: string; bookId: string; folderId: string }) {
  const outcome = await fetchFolderFiles(folderId, bookId);
  if ("error" in outcome) return <p className="text-sm text-bad">{outcome.error}</p>;
  if (outcome.files.length === 0) return <p className="text-sm text-muted">This folder has no files.</p>;
  return (
    <div>
      <p className="eyebrow mb-2">Files &amp; visibility to author</p>
      <Table>
        <thead>
          <tr>
            <Th>File</Th>
            <Th>Visible</Th>
            <Th>Label</Th>
            <Th>Category</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {outcome.files.map((f) => (
            <tr key={f.id}>
              <Td>
                {f.name} <Badge>{f.mimeType}</Badge>
              </Td>
              <Td colSpan={3}>
                <form action={setFileVisibilityAction.bind(null, userId, bookId, f.id)} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="visible" defaultChecked={f.visible} /> Visible
                  </label>
                  <input
                    name="label"
                    defaultValue={f.label ?? f.name}
                    placeholder="Label shown to author"
                    className="w-40 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                  />
                  <input
                    name="category"
                    defaultValue={f.category ?? "Other"}
                    placeholder="Category"
                    className="w-32 rounded-md border border-line bg-bg px-2 py-1 text-xs"
                  />
                  <PillButton>Save</PillButton>
                </form>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
