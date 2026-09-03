import type { StageView } from "@/lib/types";

/** "What's happening now" card. Secondary to the Timeline, but gives the stage room to breathe. */
export function StageNow({ stage }: { stage: StageView | null }) {
  if (!stage) return null;
  return (
    <section className="mt-12 max-w-[72ch]">
      <h2 className="eyebrow">What&rsquo;s happening now</h2>
      <h3 className="mt-2 text-2xl font-extrabold text-ink">{stage.label}</h3>
      {stage.description && <p className="mt-3 text-ink-2">{stage.description}</p>}
      {stage.typicalWeeks != null && (
        <p className="mt-3 text-sm text-muted">
          This step usually takes about {stage.typicalWeeks} {stage.typicalWeeks === 1 ? "week" : "weeks"}.
        </p>
      )}
    </section>
  );
}
