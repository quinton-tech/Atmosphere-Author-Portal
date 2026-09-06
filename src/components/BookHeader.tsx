import type { BookDetail } from "@/lib/types";
import { formatDate } from "./format";
import { TeaserToggle } from "./TeaserToggle";

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
      {book.teaser && <TeaserToggle text={book.teaser} />}
    </header>
  );
}
