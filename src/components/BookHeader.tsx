import type { BookDetail } from "@/lib/types";
import { formatDate } from "./format";

/** Compact header: cover on the left when we have one, title/dates to the right, synopsis tucked
 *  behind a disclosure so the page opens with status, not a wall of copy. Aims for ~140px tall. */
export function BookHeader({
  book,
}: {
  book: Pick<BookDetail, "title" | "package" | "publicationDate" | "teaser" | "stageLabel" | "coverHref">;
}) {
  return (
    <header className="flex max-w-[72ch] gap-5">
      {book.coverHref ? (
        // eslint-disable-next-line @next/next/no-img-element -- portal file-proxy URL, not a next/image candidate
        <img
          src={book.coverHref}
          alt={`Cover of ${book.title}`}
          loading="lazy"
          className="aspect-[3/2] w-24 shrink-0 rounded-lg border border-line object-cover"
        />
      ) : null}
      <div className="min-w-0">
        <p className="eyebrow">{book.package ?? "In production"}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-ink sm:text-4xl">{book.title}</h1>
        {book.publicationDate && (
          <p className="mt-2 text-ink-2">
            {new Date(book.publicationDate).getTime() <= Date.now() ? "Published" : "Publishing"} {formatDate(book.publicationDate)}
          </p>
        )}
        {book.teaser && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-teal-ink">About this book</summary>
            <p className="mt-2 max-w-[60ch] whitespace-pre-wrap text-ink-2">{book.teaser}</p>
          </details>
        )}
      </div>
    </header>
  );
}
