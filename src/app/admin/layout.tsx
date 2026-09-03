import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "./_components/AdminNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="flex w-56 shrink-0 flex-col justify-between bg-charcoal px-4 py-6 text-white">
        <div>
          <Link href="/admin/authors" className="mb-8 block px-3 text-lg font-extrabold tracking-tight text-white">
            atmosphere <span className="font-normal text-white/60">admin</span>
          </Link>
          <AdminNav />
        </div>
        <div className="px-3 text-xs text-white/50">
          <p>{admin.name ?? admin.email}</p>
          <Link href="/dashboard" className="mt-1 inline-block underline decoration-white/30 underline-offset-2 hover:text-white">
            Back to portal
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
