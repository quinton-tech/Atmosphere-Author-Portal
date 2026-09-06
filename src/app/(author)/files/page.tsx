import { DriveFileGroup } from "@/components/DriveFileGroup";
import { EmptyState } from "@/components/EmptyState";
import { formatDate } from "@/components/format";
import { UploadForm } from "@/components/UploadForm";
import { defaultBookIdForUser, listBooksForUser } from "@/lib/data/books";
import { getAuthorFiles } from "@/lib/data/files";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function FilesPage() {
  const user = await requireUser();
  const userId = effectiveUserId(user);

  const [filesView, books, defaultBookId] = await Promise.all([
    getAuthorFiles(userId),
    listBooksForUser(userId),
    defaultBookIdForUser(userId),
  ]);

  const bookTitleById = new Map(books.map((b) => [b.id, b.title]));
  const showStaleNotice = Boolean(filesView.connected && filesView.error && filesView.groups.length > 0);

  return (
    <div className="pb-16">
      <p className="eyebrow">Your files</p>
      <h1 className="mt-1 text-3xl font-extrabold text-ink">Files</h1>
      <p className="mt-2 max-w-[60ch] text-ink-2">Everything your team keeps for you in one place.</p>

      <div className="mt-10 space-y-12">
        {!filesView.connected ? (
          <EmptyState
            title="Your team hasn't connected your files yet."
            message="Ask your main contact."
          />
        ) : filesView.error && filesView.groups.length === 0 ? (
          <EmptyState
            title="We couldn't reach your files right now."
            message="Try again in a few minutes."
          />
        ) : filesView.groups.length === 0 ? (
          <EmptyState title="Your folder is empty so far." />
        ) : (
          <>
            {showStaleNotice ? (
              <p className="-mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                We couldn&rsquo;t reach Google Drive just now, showing files from{" "}
                {filesView.listedAt ? formatDate(filesView.listedAt) : "earlier"}.
              </p>
            ) : null}

            {filesView.groups.map((group) => (
              <DriveFileGroup
                key={group.folderId}
                group={group}
                bookTitle={group.bookId ? bookTitleById.get(group.bookId) : null}
              />
            ))}
          </>
        )}
      </div>

      <section className="mt-16 max-w-[72ch]">
        <h2 className="eyebrow">Send us a file</h2>
        <div className="mt-4">
          <UploadForm books={books} defaultBookId={defaultBookId} />
        </div>
      </section>
    </div>
  );
}
