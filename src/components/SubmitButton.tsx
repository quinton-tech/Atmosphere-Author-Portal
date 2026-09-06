"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "./cn";

/**
 * A form submit button that shows a pending state while its parent `<form action={...}>` (a
 * server action) is in flight. Must be rendered as a descendant of the `<form>` — `useFormStatus`
 * reads the nearest parent form's status, never its own.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "solid",
  className,
}: {
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: "solid" | "outline";
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "disabled:cursor-not-allowed disabled:opacity-60",
        variant === "solid"
          ? "rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg"
          : "rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-2",
        className,
      )}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
