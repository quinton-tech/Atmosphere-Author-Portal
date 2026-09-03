import type { ReactNode } from "react";
import { listBooksForUser } from "@/lib/data/books";
import { effectiveUserId, requireUser } from "@/lib/session";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ViewingAsBanner } from "@/components/ViewingAsBanner";

export default async function AuthorLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const books = await listBooksForUser(effectiveUserId(user));

  return (
    <div className="flex min-h-dvh flex-col">
      {user.viewingAs && <ViewingAsBanner name={user.viewingAs.name} email={user.viewingAs.email} />}
      <SiteHeader books={books} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
