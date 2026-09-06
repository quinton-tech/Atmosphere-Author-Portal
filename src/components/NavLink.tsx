"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "./cn";

/**
 * A SiteHeader nav link that knows when it's the current section: `aria-current="page"` plus a
 * visible underline/text-ink style, so the header shows where you are, not just where you can go.
 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-sm font-semibold underline-offset-4",
        active ? "text-ink underline" : "text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
