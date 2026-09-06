"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/authors", label: "Authors" },
  { href: "/admin/books", label: "Books" },
  { href: "/admin/stages", label: "Stages" },
  { href: "/admin/milestones", label: "Milestones" },
  { href: "/admin/labels", label: "Labels" },
  { href: "/admin/team", label: "Team" },
  { href: "/admin/rules", label: "Action rules" },
  { href: "/admin/uploads", label: "Uploads" },
  { href: "/admin/messages", label: "Messages" },
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
            aria-current={active ? "page" : undefined}
            className={`eyebrow flex items-center gap-2 rounded-md px-3 py-2 tracking-normal normal-case text-[13px] font-semibold text-white transition-colors ${
              active ? "bg-white/15" : "hover:bg-white/10"
            }`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-coral" : "bg-transparent"}`} />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
