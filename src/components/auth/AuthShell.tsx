import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for every `(auth)` page: quiet wordmark header, left-aligned
 * centered card, generous whitespace. No gradients, no icon grids, no chat-
 * bubble styling — matches the rest of the portal's design tokens.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="px-6 py-6 sm:px-10">
        <Link href="/sign-in" className="inline-flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight text-ink">atmosphere</span>
          <span className="eyebrow">Author Portal</span>
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-6 pb-16 sm:items-center">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-extrabold text-ink">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-[40ch] text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
