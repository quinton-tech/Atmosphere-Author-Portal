"use client";

import { useActionState, useState } from "react";
import { requestMagicLinkAction, signInWithPasswordAction, type SignInState } from "./actions";
import { TextField, SubmitButton, FormError } from "@/components/auth/fields";

const initial: SignInState = {};

export function SignInForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"link" | "password">("link");
  const [linkState, linkAction] = useActionState(requestMagicLinkAction, initial);
  const [passwordState, passwordAction] = useActionState(signInWithPasswordAction, initial);

  if (mode === "password") {
    return (
      <div className="space-y-5">
        <form action={passwordAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
          <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
          <FormError message={passwordState.error} />
          <SubmitButton>Sign in</SubmitButton>
        </form>
        <div className="flex flex-col gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode("link")}
            className="text-left font-medium text-teal-ink underline underline-offset-2"
          >
            Send me a link instead
          </button>
          <a href="/forgot-password" className="font-medium text-teal-ink underline underline-offset-2">
            Forgot your password?
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={linkAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
        <FormError message={linkState.error} />
        <SubmitButton>Send me a link</SubmitButton>
      </form>
      <button
        type="button"
        onClick={() => setMode("password")}
        className="text-left text-sm font-medium text-teal-ink underline underline-offset-2"
      >
        Use my password instead
      </button>
    </div>
  );
}
