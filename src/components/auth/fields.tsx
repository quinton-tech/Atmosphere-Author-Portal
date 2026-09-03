"use client";

import { useFormStatus } from "react-dom";
import type { InputHTMLAttributes, ReactNode } from "react";

export function TextField({
  label,
  name,
  ...rest
}: { label: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <input
        name={name}
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-coral"
        {...rest}
      />
    </label>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "solid",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "solid" | "ghost";
}) {
  const { pending } = useFormStatus();
  const base =
    "inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const cls = variant === "solid" ? `${base} bg-ink text-white hover:bg-ink-2` : `${base} border border-line text-ink-2 hover:border-ink-2`;
  return (
    <button type="submit" className={cls} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-md bg-teal-tint px-3 py-2 text-sm text-teal-ink">
      {message}
    </p>
  );
}
