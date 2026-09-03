"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/authors", label: "Authors" },
  { href: "/admin/books", label: "Books" },
  { href: "/admin/stages", label: "Stages" },
  { href: "/admin/labels", label: "Labels" },
  { href: "/admin/rules", label: "Action rules" },
  { href: "/admin/handbook", label: "Handbook" },
  { href: "/admin/assistant", label: "Assistant" },
  { href: "/admin/log", label: "Log" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/security", label: "Security" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-1">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`eyebrow rounded-md px-3 py-2 tracking-normal normal-case text-[13px] font-semibold transition-colors ${
              active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
