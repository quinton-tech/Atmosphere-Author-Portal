import type { BookDetail } from "@/lib/types";
import { formatDate } from "./format";

export function BookHeader({
  book,
}: {
  book: Pick<BookDetail, "title" | "package" | "publicationDate" | "teaser" | "stageLabel">;
}) {
  return (
    <header className="max-w-[72ch]">
      <p className="eyebrow">{book.package ?? "In production"}</p>
      <h1 className="mt-1 text-3xl font-extrabold text-ink sm:text-4xl">{book.title}</h1>
      {book.publicationDate && (
        <p className="mt-2 text-ink-2">
          {new Date(book.publicationDate).getTime() <= Date.now() ? "Published" : "Publishing"} {formatDate(book.publicationDate)}
        </p>
      )}
      {book.teaser && book.teaser.length <= 480 && (
        <p className="mt-4 border-l-2 border-teal pl-4 text-lg text-ink-2">{book.teaser}</p>
      )}
      {book.teaser && book.teaser.length > 480 && (
        <details className="mt-4 border-l-2 border-teal pl-4 text-lg text-ink-2">
          <summary className="cursor-pointer list-none">
            {book.teaser.slice(0, 380).replace(/\s+\S*$/, "")}…{" "}
            <span className="text-base font-medium text-teal-ink">Read more</span>
          </summary>
          <p className="mt-3">{book.teaser}</p>
        </details>
      )}
    </header>
  );
}
