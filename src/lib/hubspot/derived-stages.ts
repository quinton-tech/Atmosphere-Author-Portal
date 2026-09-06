/**
 * Pure functions: compute a "derived" stage_config row's display state from the milestones that
 * drive it, plus the already-computed pipeline StageViews. No DB, no HubSpot — unit-testable.
 *
 * HubSpot's Pipeline Stage dropdown only has a handful of real values, but authors are shown a
 * finer-grained "typical path" (Cold Reading, Cover Design, Interior Design Proofing, Final Files,
 * Physical Proof Copy, …) without HubSpot ever changing. Those extra steps are `stage_config` rows
 * with `kind: "derived"` whose state is computed here from the `stage_milestones` rows listed in
 * `derivedMilestoneIds`, rather than from `resolveStageKey`.
 */
import type { MilestoneView, StageView } from "@/lib/types";

export type DerivedStageInput = {
  key: string;
  label: string;
  description: string;
  sortOrder: number;
  parentStageKey: string | null;
  /** false = omit this stage entirely when none of its milestones are included/present. */
  showWhenEmpty: boolean;
  /** stage_milestones ids (MilestoneView.id) whose combined state drives this stage. */
  milestoneIds: string[];
};

/**
 * Compute one derived stage's StageView, or `null` if it should be omitted entirely.
 *
 * State rules:
 *  - any linked milestone is "done" -> "done"
 *  - else any linked milestone is "in_progress"/"scheduled" -> "current", but ONLY if the parent
 *    pipeline stage is itself "current" or "done" AND no later pipeline stage (by sortOrder) is
 *    "current" — otherwise "upcoming" (the derived step can't be "now" if the pipeline has already
 *    moved past its parent, or hasn't reached it yet).
 *  - none of the linked milestone ids appear in `milestones` at all (not included for this author,
 *    or the milestone was disabled/deleted) -> omit if `showWhenEmpty` is false, else "upcoming".
 *  - otherwise (milestones present but all "pending") -> "upcoming".
 */
export function computeDerivedStageState(
  stage: DerivedStageInput,
  milestones: Pick<MilestoneView, "id" | "state">[],
  pipelineStages: Pick<StageView, "key" | "sortOrder" | "state">[],
): StageView | null {
  const own = milestones.filter((m) => stage.milestoneIds.includes(m.id));

  if (own.length === 0 && !stage.showWhenEmpty) return null;

  let state: StageView["state"] = "upcoming";
  if (own.some((m) => m.state === "done")) {
    state = "done";
  } else if (own.some((m) => m.state === "in_progress" || m.state === "scheduled")) {
    const parent = stage.parentStageKey ? pipelineStages.find((p) => p.key === stage.parentStageKey) : undefined;
    const parentActive = !!parent && (parent.state === "current" || parent.state === "done");
    // "Later" is relative to the parent, not this derived stage's own sortOrder — a derived stage
    // is deliberately sorted right before/under its parent, so the parent itself (sortOrder >=
    // the derived stage's) must never count as "a later stage" here.
    const laterPipelineIsCurrent = !!parent && pipelineStages.some((p) => p.sortOrder > parent.sortOrder && p.state === "current");
    state = parentActive && !laterPipelineIsCurrent ? "current" : "upcoming";
  }

  return {
    key: stage.key,
    label: stage.label,
    description: stage.description,
    sortOrder: stage.sortOrder,
    typicalWeeks: null,
    isTerminal: false,
    kind: "derived",
    isDerived: true,
    state,
  };
}

/** Compute every derived stage's StageView (or omit it), preserving input order. */
export function computeDerivedStages(
  stages: DerivedStageInput[],
  milestones: Pick<MilestoneView, "id" | "state">[],
  pipelineStages: Pick<StageView, "key" | "sortOrder" | "state">[],
): StageView[] {
  const out: StageView[] = [];
  for (const s of stages) {
    const view = computeDerivedStageState(s, milestones, pipelineStages);
    if (view) out.push(view);
  }
  return out;
}
