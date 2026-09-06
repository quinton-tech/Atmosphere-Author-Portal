import type { MilestoneView } from "@/lib/types";
import { cn } from "./cn";
import { formatDate } from "./format";

/**
 * Sub-stage checkpoints within a pipeline stage (cold read, premier review, NetGalley, …), grouped
 * by stage in pipeline order. Rendered right after StageNow. A simple list with a thin left rule
 * per group — not a card grid — per CLAUDE.md's "no cards-for-everything".
 */
export function MilestoneList({ milestones }: { milestones: MilestoneView[] }) {
  if (milestones.length === 0) return null;

  const groups: { stageKey: string; stageLabel: string; items: MilestoneView[] }[] = [];
  for (const m of milestones) {
    const group = groups.find((g) => g.stageKey === m.stageKey);
    if (group) group.items.push(m);
    else groups.push({ stageKey: m.stageKey, stageLabel: m.stageLabel, items: [m] });
  }

  return (
    <section className="mt-12">
      <h2 className="eyebrow">Milestones</h2>
      <div className="mt-5 space-y-7">
        {groups.map((g) => (
          <div key={g.stageKey} className="border-l-2 border-line pl-5">
            <p className="eyebrow text-muted">{g.stageLabel}</p>
            <ul className="mt-3 space-y-3">
              {g.items.map((m) => (
                <li key={m.id} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full",
                      m.state === "done" && "bg-teal",
                      m.state === "in_progress" && "border-2 border-teal bg-bg",
                      m.state === "scheduled" && "border-2 border-teal bg-bg",
                      m.state === "pending" && "border-2 border-line bg-bg",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-ink">
                      {m.label}
                      {m.state === "scheduled" && m.at ? (
                        <span className="ml-2 text-sm font-normal text-muted">{formatDate(m.at)}</span>
                      ) : null}
                    </p>
                    {m.detail && <p className="mt-0.5 text-sm text-ink-2">{m.detail}</p>}
                    {m.href && (
                      <a
                        href={m.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-sm font-semibold text-teal"
                      >
                        View →
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
