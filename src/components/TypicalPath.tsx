import type { StageView } from "@/lib/types";
import { cn } from "./cn";

/**
 * Secondary, collapsed by default. The pipeline is NOT strictly linear (stages repeat, double
 * back, or run in parallel) — this is shown only as general context, never as a progress bar.
 */
export function TypicalPath({ stages }: { stages: StageView[] }) {
  if (stages.length === 0) return null;
  return (
    <details className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <summary className="eyebrow cursor-pointer select-none">Typical path</summary>
      <ol className="mt-4 flex flex-wrap gap-2">
        {stages.map((stage) => (
          <li
            key={stage.key}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold",
              stage.state === "current" && "bg-coral text-coral-ink",
              stage.state === "done" && "bg-teal-tint text-teal-ink",
              stage.state === "upcoming" && "bg-surface-2 text-muted",
            )}
          >
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="mt-3 max-w-[72ch] text-sm text-muted">
        Stages can repeat, run in parallel, or happen out of order — this is shown only as general context, not a
        strict progress bar.
      </p>
    </details>
  );
}
