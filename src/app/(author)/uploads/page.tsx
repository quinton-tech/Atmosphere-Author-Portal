import Link from "next/link";
import { UploadForm, UPLOAD_KIND_LABELS, UPLOAD_STATUS_LABELS, formatUploadBytes, formatUploadDate } from "@/components/UploadForm";
import { defaultBookIdForUser, listBooksForUser } from "@/lib/data/books";
import { listUploadsForUser, UPLOAD_MAX_PER_DAY } from "@/lib/data/uploads";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function UploadsPage() {
  const user = await requireUser();
  const userId = effectiveUserId(user);

  const [books, uploads, defaultBookId] = await Promise.all([
    listBooksForUser(userId),
    listUploadsForUser(userId),
    defaultBookIdForUser(userId),
  ]);

  return (
    <div className="max-w-[72ch] pb-16">
      <h1 className="text-3xl font-extrabold text-ink">Send us a file</h1>
      <p className="mt-2 text-ink-2">
        Manuscripts, signed forms, or anything else your team needs. Your team will see it within a few minutes.
      </p>

      {books.length > 0 ? (
        <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          <p className="font-semibold text-ink">Sending something for a specific book?</p>
          <ul className="mt-1 space-y-1">
            {books.map((b) => (
              <li key={b.id}>
                Go to{" "}
                <Link href={`/books/${b.id}/files`} className="font-semibold text-teal-ink underline">
                  {b.title}&rsquo;s Files.
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="mt-10">
        <UploadForm books={books} defaultBookId={defaultBookId} />
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">What you&rsquo;ve sent</h2>
        {uploads.length === 0 ? (
          <p className="mt-3 text-ink-2">You haven&rsquo;t sent anything yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{u.fileName}</p>
                  <p className="text-sm text-muted">
                    {UPLOAD_KIND_LABELS[u.kind] ?? u.kind}
                    {u.bookTitle ? ` · ${u.bookTitle}` : ""} · {formatUploadBytes(u.sizeBytes)}
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
        <p className="mt-3 text-xs text-muted">Up to {UPLOAD_MAX_PER_DAY} uploads per day.</p>
      </section>
    </div>
  );
}
