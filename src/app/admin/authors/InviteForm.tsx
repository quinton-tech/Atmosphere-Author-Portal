"use client";

import { useActionState } from "react";
import { inviteNewAuthorAction, type ActionState } from "./actions";
import { FormError, FormSuccess, PillButton } from "../_components/ui";

const initial: ActionState = {};

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteNewAuthorAction, initial);
  return (
    <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="eyebrow">
          Invite by email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="author@example.com"
          className="w-64 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="eyebrow">
          Name (optional)
        </label>
        <input id="name" name="name" type="text" className="w-48 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink" />
      </div>
      <PillButton variant="solid">{pending ? "Sending…" : "Invite"}</PillButton>
      <div className="basis-full">
        <FormError message={state.error} />
        <FormSuccess message={state.ok} />
      </div>
    </form>
  );
}
