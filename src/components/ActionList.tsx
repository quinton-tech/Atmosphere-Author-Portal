import type { ActionItem } from "@/lib/types";
import { cn } from "./cn";

/**
 * Pinned near the top of the book page. "action" severity is the only place coral appears for
 * emphasis (per CLAUDE.md: coral is reserved for "action needed"); "info" uses the teal tint.
 */
export function ActionList({ actions }: { actions: ActionItem[] }) {
  if (actions.length === 0) return null;
  return (
    <ul className="space-y-4">
      {actions.map((action) => {
        const isAction = action.severity === "action";
        return (
          <li
            key={action.id}
            className={cn("rounded-2xl border p-5 sm:p-6", isAction ? "border-coral bg-bg" : "border-teal-tint bg-teal-tint")}
          >
            <span
              className={cn(
                "eyebrow inline-block rounded-full px-3 py-1",
                isAction ? "bg-coral text-coral-ink" : "bg-teal text-bg",
              )}
            >
              {isAction ? "Action needed" : "Update"}
            </span>
            <h3 className="mt-3 text-lg font-bold text-ink">{action.title}</h3>
            <p className="mt-1 max-w-[72ch] text-ink-2">{action.message}</p>
            {action.ctaLabel && action.ctaUrl && (
              <a
                href={action.ctaUrl}
                className="mt-4 inline-block rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg"
              >
                {action.ctaLabel}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
