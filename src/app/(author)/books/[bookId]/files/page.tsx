import { notFound, redirect } from "next/navigation";
import { getBookForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";

/**
 * Per-book files used to be their own page; now every author's files live on one page
 * (`/files`, grouped by Drive folder — see `src/app/(author)/files/page.tsx`), with each
 * book-matched subfolder anchored at `#book-<id>`. This route stays only so old links
 * (`/books/[bookId]/files`) keep working, after the same ownership check the old page had.
 */
export default async function BookFilesRedirectPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const user = await requireUser();
  const userId = effectiveUserId(user);
  const book = await getBookForUser(userId, bookId);
  if (!book) notFound();

  redirect(`/files#book-${bookId}`);
}
