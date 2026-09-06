"use client";

import { useTransition } from "react";

/**
 * "Revoke" needs to name the account before it fires — a plain submit button is one misclick
 * away from disabling someone's access and killing every session they have open. Matches
 * PillButton's "danger" look (see ../_components/ui.tsx) without needing to add an onClick prop
 * to that shared component.
 */
export function RevokeButton({ email, action }: { email: string; action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Revoke access for ${email}? They'll be signed out of every device immediately.`)) {
          startTransition(() => {
            void action();
          });
        }
      }}
      className="inline-flex items-center justify-center gap-1 rounded-full border border-bad px-4 py-1.5 text-sm font-semibold text-bad transition-colors hover:bg-bad/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
