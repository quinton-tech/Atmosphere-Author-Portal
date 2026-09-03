import Link from "next/link";
import type { BookSummary } from "@/lib/types";
import { signOutAction } from "@/app/(author)/actions";
import { BookSwitcher } from "./BookSwitcher";

export function SiteHeader({ books }: { books: BookSummary[] }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link href="/dashboard" className="flex flex-col leading-none">
          <span className="text-xl font-extrabold tracking-tight text-ink">atmosphere</span>
          <span className="eyebrow mt-1">Author Portal</span>
        </Link>
        <nav className="flex items-center gap-4">
          <BookSwitcher books={books} />
          <Link href="/account" className="text-sm font-semibold text-ink-2 hover:text-ink">
            Account
          </Link>
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
