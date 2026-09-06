import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { defaultBookIdForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";

/** Kept in sync with the literal cookie name written client-side in `BookSwitcher.tsx` and read
 *  in `(author)/layout.tsx`. */
const BOOK_COOKIE = "ap_book";

export default async function DashboardPage() {
  const user = await requireUser();
  const jar = await cookies();
  const remembered = jar.get(BOOK_COOKIE)?.value ?? null;
  const bookId = await defaultBookIdForUser(effectiveUserId(user), remembered);

  if (bookId) redirect(`/books/${bookId}`);

  return <EmptyState />;
}
