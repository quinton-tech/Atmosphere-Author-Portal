"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ForgotPasswordState } from "./actions";
import { TextField, SubmitButton, FormError, FormNotice } from "@/components/auth/fields";

const initial: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initial);

  if (state.submitted) {
    return (
      <FormNotice message="If an account exists for that address, we've sent a link to reset your password. It's valid for 30 minutes." />
    );
  }

  return (
    <form action={action} className="space-y-4">
      <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
      <FormError message={state.error} />
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}
