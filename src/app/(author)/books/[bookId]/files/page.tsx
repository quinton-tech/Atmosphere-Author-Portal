import { notFound } from "next/navigation";
import { FileGrid } from "@/components/FileGrid";
import { getBookForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function BookFilesPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const user = await requireUser();
  const book = await getBookForUser(effectiveUserId(user), bookId);
  if (!book) notFound();

  return (
    <div className="pb-16">
      <p className="eyebrow">{book.title}</p>
      <h1 className="mt-1 text-3xl font-extrabold text-ink">Files</h1>
      <div className="mt-8">
        <FileGrid files={book.files} />
      </div>
    </div>
  );
}
