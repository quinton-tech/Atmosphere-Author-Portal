"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "./actions";
import { TextField, SubmitButton, FormError } from "@/components/auth/fields";

const initial: ResetPasswordState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, initial);

  if (state.success) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">Your password has been updated.</p>
        <a
          href="/sign-in"
          className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink-2"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
      <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      <FormError message={state.error} />
      <SubmitButton>Update password</SubmitButton>
    </form>
  );
}
