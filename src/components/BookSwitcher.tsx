"use client";

import { useRouter, usePathname } from "next/navigation";
import type { BookSummary } from "@/lib/types";

/** Only rendered by SiteHeader when the author has more than one book. */
export function BookSwitcher({ books }: { books: BookSummary[] }) {
  const router = useRouter();
  const pathname = usePathname();

  if (books.length <= 1) return null;

  const match = pathname.match(/^\/books\/([^/]+)/);
  const current = match?.[1] ?? books[0]?.id ?? "";

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Switch book</span>
      <select
        value={current}
        onChange={(e) => router.push(`/books/${e.target.value}`)}
        className="rounded-full border border-line bg-bg px-4 py-2 text-sm font-semibold text-ink"
      >
        {books.map((book) => (
          <option key={book.id} value={book.id}>
            {book.title}
          </option>
        ))}
      </select>
    </label>
  );
}
