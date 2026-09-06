import Link from "next/link";
import type { BookSummary } from "@/lib/types";
import { signOutAction } from "@/app/(author)/actions";
import { BookSwitcher } from "./BookSwitcher";
import { NavLink } from "./NavLink";

export function SiteHeader({
  books,
  rememberedBookId = null,
}: {
  books: BookSummary[];
  /** From the `ap_book` cookie, read server-side in the layout. See BookSwitcher. */
  rememberedBookId?: string | null;
}) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link href="/dashboard" className="flex flex-col leading-none">
          <span className="text-xl font-extrabold tracking-tight text-ink">atmosphere</span>
          <span className="eyebrow mt-1">Author Portal</span>
        </Link>
        <nav className="flex items-center gap-4">
          <BookSwitcher books={books} rememberedBookId={rememberedBookId} />
          <NavLink href="/messages">Messages</NavLink>
          <NavLink href="/uploads">Uploads</NavLink>
          <NavLink href="/account">Account</NavLink>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-2 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
