import { uploadFileAction } from "@/app/(author)/uploads/actions";
import { UPLOAD_MAX_PER_DAY } from "@/lib/data/uploads";

/** Shared author-facing copy for upload kind/status, used by both the /uploads page and a book's Files area. */
export const UPLOAD_KIND_LABELS: Record<string, string> = {
  manuscript: "Manuscript",
  form: "Form / paperwork",
  other: "Other",
};

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  stored: "Sent",
  demo: "Sent (demo)",
  failed: "Failed",
};

export function formatUploadBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUploadDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

const selectCls = "mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink";

type UploadFormProps = {
  /** Where the server action redirects back to after success/failure — always a same-app path. */
  redirectTo: string;
  error?: string;
  ok?: string;
} & (
  | { book: { id: string; title: string }; books?: never; defaultBookId?: never }
  | { books: { id: string; title: string }[]; defaultBookId: string | null; book?: never }
);

/**
 * Server component wrapping `uploadFileAction` (src/app/(author)/uploads/actions.ts). Two modes:
 *  - `book` fixed: used embedded in a book's Files area — the book is preselected via a hidden
 *    input and can't be changed from this form.
 *  - `books` + `defaultBookId`: used on /uploads — a select defaulting to the author's default
 *    book, with "Not tied to a specific book" as the top option.
 * Ownership of `bookId` is re-verified server-side in `createUploadForUser`, regardless of what
 * this form sends.
 */
export function UploadForm(props: UploadFormProps) {
  const { redirectTo, error, ok } = props;
  return (
    <div>
      {error ? (
        <p role="alert" className="mb-4 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="mb-4 text-sm font-semibold text-teal-ink">
          {ok}
        </p>
      ) : null}

      <form action={uploadFileAction} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="redirectTo" value={redirectTo} />

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

        {props.book ? (
          <input type="hidden" name="bookId" value={props.book.id} />
        ) : (
          <label className="block">
            <span className="eyebrow">Book</span>
            <select name="bookId" defaultValue={props.defaultBookId ?? ""} className={selectCls}>
              <option value="">Not tied to a specific book</option>
              {props.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="eyebrow">What is it?</span>
          <select name="kind" defaultValue="manuscript" className={selectCls}>
            {Object.entries(UPLOAD_KIND_LABELS).map(([value, label]) => (
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
      <p className="mt-3 text-xs text-muted">Up to {UPLOAD_MAX_PER_DAY} uploads per day.</p>
    </div>
  );
}
