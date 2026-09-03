import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { defaultBookIdForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();
  const bookId = await defaultBookIdForUser(effectiveUserId(user));

  if (bookId) redirect(`/books/${bookId}`);

  return <EmptyState />;
}
