"use client";

import { useActionState } from "react";
import { verifyTwoFactorCodeAction, type VerifyTwoFaState } from "./actions";
import { TextField, SubmitButton, FormError } from "@/components/auth/fields";

const initial: VerifyTwoFaState = {};

export function VerifyTwoFactorForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyTwoFactorCodeAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        required
        autoFocus
      />
      <FormError message={state.error} />
      <SubmitButton>Verify</SubmitButton>
    </form>
  );
}
