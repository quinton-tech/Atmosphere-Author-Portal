"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { BookSummary } from "@/lib/types";

/** Kept in sync with the literal cookie name read server-side in `(author)/layout.tsx` and
 *  `(author)/dashboard/page.tsx` — not shared as an import since those are server modules and this
 *  is a client component. */
const BOOK_COOKIE = "ap_book";
const BOOK_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // ~6 months

/**
 * Only rendered by SiteHeader when the author has more than one book.
 *
 * The dropdown's value used to fall back to `books[0]` whenever the URL had no bookId — so
 * navigating from a book's Files to the account-wide Messages/Uploads/Account pages made it look
 * like the selection had silently "switched" to a different book. Now the last book page visited
 * is remembered in the `ap_book` cookie (written here, read server-side by the layout) and used to
 * highlight the right book even on pages that aren't scoped to one.
 */
export function BookSwitcher({
  books,
  rememberedBookId = null,
}: {
  books: BookSummary[];
  /** From the `ap_book` cookie, already validated by the layout against this user's own books. */
  rememberedBookId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const urlBookId = pathname.match(/^\/books\/([^/]+)/)?.[1] ?? null;
  const isBookPage = Boolean(urlBookId);

  useEffect(() => {
    if (!urlBookId) return;
    document.cookie = `${BOOK_COOKIE}=${urlBookId}; path=/; max-age=${BOOK_COOKIE_MAX_AGE}; samesite=lax`;
  }, [urlBookId]);

  if (books.length <= 1) return null;

  const remembered = rememberedBookId && books.some((b) => b.id === rememberedBookId) ? rememberedBookId : null;
  const current = urlBookId ?? remembered ?? books[0]?.id ?? "";
  const currentTitle = books.find((b) => b.id === current)?.title ?? "";

  return (
    <label className="flex items-center gap-2">
      {isBookPage ? (
        <span className="sr-only">Switch book</span>
      ) : (
        // This section (Messages/Uploads/Account) isn't scoped to one book — make it clear the
        // dropdown is only showing which book was last viewed, not filtering this page's content.
        <span className="eyebrow text-muted">Viewing:</span>
      )}
      <select
        aria-label={isBookPage ? undefined : `Viewing ${currentTitle}. Switch book`}
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
