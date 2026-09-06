import type { ActionItem, NextUpdate, StageView } from "@/lib/types";
import { ActionList } from "./ActionList";
import { formatDate } from "./format";

function nextUpdateText(nextUpdate: NextUpdate | null): string {
  if (nextUpdate?.at) return `${nextUpdate.label} ${formatDate(nextUpdate.at)}`;
  return "Your team's next update is due";
}

/**
 * The calm, single-glance status block directly under the book title: current stage, what the
 * author needs to do, and what's coming next. Replaces the old StageNow card and the standalone
 * ActionList that used to sit above the timeline — this is now the one place actions show up.
 */
export function StatusNow({
  stage,
  actions,
  nextUpdate,
}: {
  stage: StageView | null;
  actions: ActionItem[];
  nextUpdate: NextUpdate | null;
}) {
  const heading = stage ? (stage.isTerminal ? "Your book is published" : stage.label) : null;

  return (
    <section className="mt-8 max-w-[72ch]">
      <p className="eyebrow">Right now</p>
      {heading && <h2 className="mt-2 text-2xl font-extrabold text-ink sm:text-3xl">{heading}</h2>}
      {stage?.description && <p className="mt-3 text-ink-2">{stage.description}</p>}

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <h3 className="eyebrow text-muted">What we need from you</h3>
          {actions.length > 0 ? (
            <div className="mt-3">
              <ActionList actions={actions} />
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-ink-2">
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-tint text-xs font-bold text-teal-ink"
              >
                ✓
              </span>
              Nothing needed from you right now.
            </p>
          )}
        </div>

        <div>
          <h3 className="eyebrow text-muted">What&rsquo;s next</h3>
          <p className="mt-3 text-ink-2">{nextUpdateText(nextUpdate)}</p>
          {stage && !stage.isTerminal && stage.typicalWeeks != null && (
            <p className="mt-2 text-sm text-muted">
              This step usually takes about {stage.typicalWeeks} {stage.typicalWeeks === 1 ? "week" : "weeks"}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
