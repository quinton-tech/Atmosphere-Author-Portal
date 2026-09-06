import { notFound } from "next/navigation";
import { FileGrid } from "@/components/FileGrid";
import { UploadForm, UPLOAD_KIND_LABELS, UPLOAD_STATUS_LABELS, formatUploadBytes, formatUploadDate } from "@/components/UploadForm";
import { getBookForUser } from "@/lib/data/books";
import { listUploadsForBook } from "@/lib/data/uploads";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function BookFilesPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const user = await requireUser();
  const userId = effectiveUserId(user);
  const book = await getBookForUser(userId, bookId);
  if (!book) notFound();

  const uploads = await listUploadsForBook(userId, bookId);

  return (
    <div className="pb-16">
      <p className="eyebrow">{book.title}</p>
      <h1 className="mt-1 text-3xl font-extrabold text-ink">Files</h1>

      <section className="mt-8">
        <h2 className="eyebrow">From your team</h2>
        <div className="mt-4">
          <FileGrid files={book.files} filesConnected={book.filesConnected} />
        </div>
      </section>

      <section className="mt-12 max-w-[72ch]">
        <h2 className="eyebrow">Sent by you</h2>

        {uploads.length === 0 ? (
          <p className="mt-3 text-ink-2">You haven&rsquo;t sent anything for this book yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{u.fileName}</p>
                  <p className="text-sm text-muted">
                    {UPLOAD_KIND_LABELS[u.kind] ?? u.kind} · {formatUploadBytes(u.sizeBytes)}
                  </p>
                  {u.note ? <p className="mt-1 text-sm text-ink-2">&ldquo;{u.note}&rdquo;</p> : null}
                </div>
                <div className="text-right text-sm">
                  <p className="text-ink-2">{formatUploadDate(u.createdAt)}</p>
                  <p className={u.status === "failed" ? "font-semibold text-coral-ink" : "text-muted"}>
                    {UPLOAD_STATUS_LABELS[u.status] ?? u.status}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <UploadForm book={{ id: book.id, title: book.title }} />
        </div>
      </section>
    </div>
  );
}
