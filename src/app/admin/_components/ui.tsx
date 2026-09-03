import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-[72ch] text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`eyebrow border-b border-line px-3 py-2 text-left ${className}`} scope="col">
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
  title,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={`border-b border-line px-3 py-2 align-top text-sm text-ink-2 ${className}`}>
      {children}
    </td>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-bg shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-left">{children}</table>
    </div>
  );
}

const pillBase =
  "inline-flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50";

export function PillLink({ href, children, variant = "ghost" }: { href: string; children: ReactNode; variant?: "solid" | "ghost" }) {
  const cls =
    variant === "solid"
      ? `${pillBase} bg-ink text-white hover:bg-ink-2`
      : `${pillBase} border border-line text-ink-2 hover:border-ink-2`;
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function PillButton({
  children,
  variant = "ghost",
  type = "submit",
  formAction,
}: {
  children: ReactNode;
  variant?: "solid" | "ghost" | "danger";
  type?: "submit" | "button";
  /** Lets one <form> host multiple submit buttons that each hit a different server action. */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const cls =
    variant === "solid"
      ? `${pillBase} bg-ink text-white hover:bg-ink-2`
      : variant === "danger"
        ? `${pillBase} border border-bad text-bad hover:bg-bad/10`
        : `${pillBase} border border-line text-ink-2 hover:border-ink-2`;
  return (
    <button type={type} formAction={formAction} className={cls}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" | "teal" }) {
  const toneCls: Record<string, string> = {
    muted: "bg-surface text-muted",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/10 text-warn",
    bad: "bg-bad/10 text-bad",
    teal: "bg-teal-tint text-teal-ink",
  };
  return <span className={`eyebrow inline-block rounded-full px-2 py-0.5 ${toneCls[tone]}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-bg p-4 shadow-card ${className}`}>{children}</div>;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">
      {message}
    </p>
  );
}

export function Pagination({ hasMore, nextHref }: { hasMore: boolean; nextHref: string }) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex justify-end">
      <PillLink href={nextHref}>Next page →</PillLink>
    </div>
  );
}
