import { listBooksForUser } from "@/lib/data/books";
import { listUploadsForUser, UPLOAD_MAX_PER_DAY } from "@/lib/data/uploads";
import { effectiveUserId, requireUser } from "@/lib/session";
import { uploadFileAction } from "./actions";

const KIND_LABELS: Record<string, string> = {
  manuscript: "Manuscript",
  form: "Form / paperwork",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  stored: "Sent",
  demo: "Sent (demo)",
  failed: "Failed",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function UploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireUser();
  const userId = effectiveUserId(user);
  const { ok, error } = await searchParams;

  const [books, uploads] = await Promise.all([listBooksForUser(userId), listUploadsForUser(userId)]);

  return (
    <div className="max-w-[72ch] pb-16">
      <h1 className="text-3xl font-extrabold text-ink">Send us a file</h1>
      <p className="mt-2 text-ink-2">
        Manuscripts, signed forms, or anything else your team needs. Your team will see it within a few minutes.
      </p>

      <section className="mt-10">
        {error && (
          <p role="alert" className="mb-4 text-sm font-semibold text-coral-ink">
            {error}
          </p>
        )}
        {ok && (
          <p role="status" className="mb-4 text-sm font-semibold text-teal-ink">
            {ok}
          </p>
        )}

        <form action={uploadFileAction} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="eyebrow">File</span>
            <input
              name="file"
              type="file"
              required
              accept=".pdf,.docx,.doc,.rtf,.txt,.jpg,.jpeg,.png,.zip"
              className="mt-2 block w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink"
            />
            <span className="mt-1 block text-xs text-muted">PDF, Word, RTF, TXT, JPG, PNG, or ZIP. Up to 50 MB.</span>
          </label>

          <label className="block">
            <span className="eyebrow">Book</span>
            <select name="bookId" className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink">
              <option value="">Not tied to a specific book</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">What is it?</span>
            <select name="kind" defaultValue="manuscript" className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink">
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block sm:col-span-2">
            <span className="eyebrow">Note (optional)</span>
            <textarea
              name="note"
              rows={3}
              placeholder="Anything your team should know about this file"
              className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink"
            />
          </label>

          <div className="sm:col-span-2">
            <button type="submit" className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg">
              Send to your team
            </button>
          </div>
        </form>
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
                    {KIND_LABELS[u.kind] ?? u.kind}
                    {u.bookTitle ? ` · ${u.bookTitle}` : ""} · {formatBytes(u.sizeBytes)}
                  </p>
                  {u.note ? <p className="mt-1 text-sm text-ink-2">&ldquo;{u.note}&rdquo;</p> : null}
                </div>
                <div className="text-right text-sm">
                  <p className="text-ink-2">{fmtDate(u.createdAt)}</p>
                  <p className={u.status === "failed" ? "font-semibold text-coral-ink" : "text-muted"}>
                    {STATUS_LABELS[u.status] ?? u.status}
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
