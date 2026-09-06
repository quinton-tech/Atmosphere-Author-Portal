import { UploadFormClient } from "./UploadFormClient";
import { UPLOAD_MAX_PER_DAY } from "@/lib/data/uploads";

export { UPLOAD_KIND_LABELS, UPLOAD_STATUS_LABELS, formatUploadBytes, formatUploadDate } from "@/lib/uploads/shared";

type UploadFormProps =
  | { book: { id: string; title: string }; books?: never; defaultBookId?: never }
  | { books: { id: string; title: string }[]; defaultBookId: string | null; book?: never };

/**
 * Server wrapper: decides book-fixed (embedded on a book's Files area) vs book-select (the
 * free-standing /uploads picker) mode, and renders the client component that owns the actual
 * submit/progress/validation UI — `UploadFormClient.tsx`, which speaks the direct-to-Drive
 * resumable upload protocol (see `src/lib/data/uploads.ts` and `src/app/api/uploads/*`).
 *
 * There's no more `redirectTo`/`?ok=`/`?error=` flash: the client component shows its own
 * success/error state inline, since it's driving the whole upload itself now rather than
 * submitting a `<form action>` server action and waiting for a redirect.
 */
export function UploadForm(props: UploadFormProps) {
  return (
    <div>
      {props.book ? <UploadFormClient book={props.book} /> : <UploadFormClient books={props.books} defaultBookId={props.defaultBookId} />}
      <p className="mt-3 text-xs text-muted">Up to {UPLOAD_MAX_PER_DAY} uploads per day.</p>
    </div>
  );
}
