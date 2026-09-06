import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { listBooksForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ViewingAsBanner } from "@/components/ViewingAsBanner";

/** Kept in sync with the literal cookie name written client-side in `BookSwitcher.tsx` and read
 *  in `dashboard/page.tsx`. Not httpOnly — it only remembers which book's page was last open, no
 *  sensitive data, and BookSwitcher needs to write it from the client. */
const BOOK_COOKIE = "ap_book";

export default async function AuthorLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [books, jar] = await Promise.all([listBooksForUser(effectiveUserId(user)), cookies()]);

  const cookieBookId = jar.get(BOOK_COOKIE)?.value ?? null;
  // Only trust the cookie when it names one of this user's own books.
  const rememberedBookId = cookieBookId && books.some((b) => b.id === cookieBookId) ? cookieBookId : null;

  return (
    <div className="flex min-h-dvh flex-col">
      {user.viewingAs && <ViewingAsBanner name={user.viewingAs.name} email={user.viewingAs.email} />}
      <SiteHeader books={books} rememberedBookId={rememberedBookId} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
