import type { PhaseView } from "@/lib/types";
import { cn } from "./cn";
import { formatDate } from "./format";

/**
 * PRIMARY visual for a book's production status: every phase of the typical path in order, with
 * what happened inside each one. Phases the book has passed are filled, the current phase is
 * coral, upcoming phases are hollow. Stages can repeat or overlap in reality, so the connector is
 * a guide rather than a strict progress bar.
 */
export function PhaseTimeline({ phases }: { phases: PhaseView[] }) {
  if (phases.length === 0) return null;
  return (
    <ol className="relative">
      {phases.map((phase, i) => {
        const isLast = i === phases.length - 1;
        const date = phase.enteredAt ?? phase.events[0]?.at ?? null;
        const hasBody = phase.events.length > 0 || phase.milestones.length > 0 || (phase.state === "current" && phase.description);
        return (
          <li key={phase.key} className={cn("relative pl-9", !isLast && "pb-7")}>
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[7px] top-5 bottom-0 w-px",
                  phase.state === "upcoming" ? "border-l border-dashed border-line" : "bg-teal/50",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-[3px] h-[15px] w-[15px] rounded-full border-2",
                phase.state === "done" && "border-teal bg-teal",
                phase.state === "current" && "border-coral bg-coral ring-4 ring-coral/25",
                phase.state === "upcoming" && "border-line bg-bg",
              )}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p
                className={cn(
                  "font-bold",
                  phase.state === "upcoming" ? "text-muted" : "text-ink",
                  phase.state === "current" && "text-lg",
                )}
              >
                {phase.state === "current" ? "Now: " : ""}
                {phase.label}
              </p>
              {date && phase.state !== "upcoming" && (
                <time dateTime={date} className="eyebrow">
                  {formatDate(date)}
                </time>
              )}
              {phase.state === "upcoming" && phase.typicalWeeks && (
                <span className="eyebrow">About {phase.typicalWeeks} weeks</span>
              )}
            </div>

            {hasBody && (
              <ul className="mt-2 space-y-1.5">
                {phase.state === "current" && phase.description && (
                  <li className="max-w-[60ch] text-sm text-ink-2">{phase.description}</li>
                )}
                {phase.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-ink-2">{e.title}</span>
                    {e.detail && <span className="text-muted">· {e.detail}</span>}
                    {e.at && (
                      <time dateTime={e.at} className="text-muted">
                        · {formatDate(e.at)}
                      </time>
                    )}
                  </li>
                ))}
                {phase.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 text-sm">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full",
                        m.state === "done" && "bg-teal",
                        (m.state === "in_progress" || m.state === "scheduled") && "border-2 border-teal bg-bg",
                        m.state === "pending" && "border-2 border-line bg-bg",
                      )}
                    />
                    <span className="min-w-0">
                      <span className={m.state === "pending" ? "text-muted" : "text-ink-2"}>{m.label}</span>
                      {m.detail && <span className="text-muted"> · {m.detail}</span>}
                      {m.href && (
                        <>
                          {" "}
                          <a href={m.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-ink">
                            View
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
