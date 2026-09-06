import Link from "next/link";
import type { DriveFolderGroup } from "@/lib/types";
import { Thumb } from "./Thumb";
import { formatDate } from "./format";

function shortKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word")) return "DOCX";
  if (mimeType.includes("sheet")) return "XLSX";
  if (mimeType.includes("presentation")) return "PPTX";
  return "File";
}

/**
 * One folder's worth of files on the author "Your files" page (`src/app/(author)/files/page.tsx`):
 * either the root group (the author's own folder, heading "Your folder") or a per-book subfolder.
 *
 * Anchored twice so links elsewhere in the app can land directly on it:
 *  - `folder-<folderId>` always
 *  - `book-<bookId>` as well, when staff have matched this subfolder to a book (the book page's
 *    "View files" link and PublishedSummary's "Your files" pill both point at `/files#book-<id>`)
 */
export function DriveFileGroup({ group, bookTitle }: { group: DriveFolderGroup; bookTitle?: string | null }) {
  // The root group (the author's own folder, not a subfolder) has an empty `path`.
  const heading = group.path.length === 0 ? "Your folder" : group.name;

  return (
    <section id={`folder-${group.folderId}`} className="scroll-mt-8">
      {group.bookId ? <span id={`book-${group.bookId}`} className="block scroll-mt-8" /> : null}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="eyebrow">{heading}</h2>
        {group.bookId ? (
          <Link
            href={`/books/${group.bookId}`}
            className="text-sm font-semibold text-teal-ink underline-offset-4 hover:underline"
          >
            → Open {bookTitle ?? "this book"}
          </Link>
        ) : null}
      </div>

      {group.files.length === 0 ? (
        <p className="mt-3 text-ink-2">Nothing here yet.</p>
      ) : (
        <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {group.files.map((file) => (
            <li key={file.id} className="overflow-hidden rounded-2xl border border-line">
              {file.thumbnailHref ? (
                <Thumb src={file.thumbnailHref} fallback={shortKind(file.mimeType)} />
              ) : (
                <div className="eyebrow flex h-32 w-full items-center justify-center bg-surface text-muted">
                  {shortKind(file.mimeType)}
                </div>
              )}
              <div className="p-4">
                <p className="truncate font-semibold text-ink">{file.label}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="eyebrow rounded-full bg-surface px-2 py-0.5">{file.category}</span>
                  {file.modifiedAt ? <span>{formatDate(file.modifiedAt)}</span> : null}
                </div>
                <div className="mt-3 flex gap-3 text-sm">
                  <a href={file.href} className="rounded-full border border-line px-3 py-1 font-semibold text-ink">
                    Open
                  </a>
                  <a href={file.downloadHref} className="rounded-full border border-line px-3 py-1 font-semibold text-ink">
                    Download
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
