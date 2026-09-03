"use client";

import { useActionState } from "react";
import { enrollTotpAction, type EnrollTotpState } from "./actions";
import { TextField, SubmitButton, FormError } from "@/components/auth/fields";

const initial: EnrollTotpState = {};

export function EnrollTotpForm({ secret, qrDataUrl, manualKey }: { secret: string; qrDataUrl: string; manualKey: string }) {
  const [state, action] = useActionState(enrollTotpAction, initial);

  return (
    <form action={action} className="mt-6 max-w-sm space-y-5">
      <input type="hidden" name="secret" value={secret} />
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image doesn't help here */}
      <img src={qrDataUrl} alt="Scan with your authenticator app" width={200} height={200} className="rounded-md border border-line" />
      <p className="text-xs text-muted">
        Can&apos;t scan? Enter this key manually:{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-ink-2">{manualKey}</code>
      </p>
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        required
      />
      <FormError message={state.error} />
      <SubmitButton>Turn on two-factor authentication</SubmitButton>
    </form>
  );
}
