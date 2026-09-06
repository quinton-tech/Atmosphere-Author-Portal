import type { MilestoneView, StageView } from "@/lib/types";
import { cn } from "./cn";

/**
 * Secondary, collapsed by default. The pipeline is NOT strictly linear (stages repeat, double
 * back, or run in parallel) — this is shown only as general context, never as a progress bar.
 */
export function TypicalPath({ stages, milestones = [] }: { stages: StageView[]; milestones?: MilestoneView[] }) {
  if (stages.length === 0) return null;

  const countsByStage = new Map<string, { done: number; total: number }>();
  for (const m of milestones) {
    const c = countsByStage.get(m.stageKey) ?? { done: 0, total: 0 };
    c.total += 1;
    if (m.state === "done") c.done += 1;
    countsByStage.set(m.stageKey, c);
  }

  return (
    <details className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <summary className="eyebrow cursor-pointer select-none">Typical path</summary>
      <ol className="mt-4 flex flex-wrap gap-2">
        {stages.map((stage) => {
          const counts = countsByStage.get(stage.key);
          return (
            <li
              key={stage.key}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
                // Derived stages (a finer-grained "typical path" computed from milestones, not
                // HubSpot's own Pipeline Stage) are visually lighter: a thin outline instead of a
                // filled pill, with a small hollow dot standing in for HubSpot's solid fill.
                stage.isDerived
                  ? "border border-dashed border-line text-muted"
                  : cn(
                      stage.state === "current" && "bg-coral text-coral-ink",
                      stage.state === "done" && "bg-teal-tint text-teal-ink",
                      stage.state === "upcoming" && "bg-surface-2 text-muted",
                    ),
              )}
            >
              {stage.isDerived && (
                <span
                  aria-hidden
                  className={cn(
                    "h-[7px] w-[7px] shrink-0 rounded-full border",
                    stage.state === "done" && "border-teal bg-teal",
                    stage.state === "current" && "border-coral-ink bg-coral",
                    stage.state === "upcoming" && "border-muted bg-transparent",
                  )}
                />
              )}
              {stage.label}
              {counts ? <span className="ml-1 font-normal opacity-75">{counts.done}/{counts.total}</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 max-w-[72ch] text-sm text-muted">
        Stages can repeat, run in parallel, or happen out of order — this is shown only as general context, not a
        strict progress bar.
      </p>
    </details>
  );
}
