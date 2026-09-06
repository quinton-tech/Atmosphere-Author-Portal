import { describe, expect, it } from "vitest";
import { computeDerivedStageState, computeDerivedStages, type DerivedStageInput } from "./derived-stages";
import type { StageView } from "@/lib/types";

function pipeline(key: string, sortOrder: number, state: StageView["state"]): Pick<StageView, "key" | "sortOrder" | "state"> {
  return { key, sortOrder, state };
}

function stage(over: Partial<DerivedStageInput> = {}): DerivedStageInput {
  return {
    key: "cover_design",
    label: "Cover Design",
    description: "",
    sortOrder: 55,
    parentStageKey: "interior_design",
    showWhenEmpty: true,
    milestoneIds: ["m1"],
    ...over,
  };
}

const pipelineStages = [pipeline("proofreading", 30, "done"), pipeline("interior_design", 60, "current"), pipeline("publicity", 80, "upcoming")];

describe("computeDerivedStageState", () => {
  it("is done when any linked milestone is done", () => {
    const view = computeDerivedStageState(stage(), [{ id: "m1", state: "done" }], pipelineStages);
    expect(view?.state).toBe("done");
    expect(view?.kind).toBe("derived");
    expect(view?.isDerived).toBe(true);
    expect(view?.completion).toBe("confirmed");
  });

  it("is current when in-progress and the parent pipeline stage is current, with no later stage current", () => {
    const view = computeDerivedStageState(stage(), [{ id: "m1", state: "in_progress" }], pipelineStages);
    expect(view?.state).toBe("current");
    expect(view?.completion).toBeNull();
  });

  it("is done when the parent pipeline stage is already done, even if a milestone is still in progress", () => {
    const parentDoneNoLaterCurrent = [pipeline("proofreading", 30, "done"), pipeline("interior_design", 60, "upcoming")];
    const view = computeDerivedStageState(stage({ parentStageKey: "proofreading" }), [{ id: "m1", state: "scheduled" }], parentDoneNoLaterCurrent);
    expect(view?.state).toBe("done");
    expect(view?.completion).toBe("inferred");
  });

  it("is done when the parent is done and the pipeline has moved further on", () => {
    // e.g. cold_reading's parent (proofreading) finished and the pipeline has since moved on to
    // interior_design — the phase is behind the book regardless of a stale milestone value.
    const view = computeDerivedStageState(stage({ parentStageKey: "proofreading" }), [{ id: "m1", state: "scheduled" }], pipelineStages);
    expect(view?.state).toBe("done");
    expect(view?.completion).toBe("inferred");
  });

  it("is upcoming when in-progress but the parent pipeline stage hasn't started", () => {
    const view = computeDerivedStageState(stage({ parentStageKey: "publicity" }), [{ id: "m1", state: "in_progress" }], pipelineStages);
    expect(view?.state).toBe("upcoming");
  });

  it("is upcoming when in-progress but a later pipeline stage is already current", () => {
    // Parent ("interior_design") is current, but so is a later stage — shouldn't happen in
    // practice (only one pipeline stage is ever "current"), but the guard should hold regardless.
    const laterCurrent = [pipeline("interior_design", 60, "current"), pipeline("publicity", 80, "current")];
    const view = computeDerivedStageState(stage(), [{ id: "m1", state: "in_progress" }], laterCurrent);
    expect(view?.state).toBe("upcoming");
  });

  it("is upcoming when milestones exist but are all pending", () => {
    const view = computeDerivedStageState(stage(), [{ id: "m1", state: "pending" }], pipelineStages);
    expect(view?.state).toBe("upcoming");
    expect(view?.completion).toBeNull();
  });

  it("is omitted when no linked milestone is present and showWhenEmpty is false", () => {
    const view = computeDerivedStageState(stage({ showWhenEmpty: false, milestoneIds: ["missing"] }), [{ id: "m1", state: "done" }], pipelineStages);
    expect(view).toBeNull();
  });

  it("stays upcoming (not omitted) when no linked milestone is present and showWhenEmpty is true", () => {
    const view = computeDerivedStageState(stage({ showWhenEmpty: true, milestoneIds: [] }), [], pipelineStages);
    expect(view?.state).toBe("upcoming");
  });
});

describe("computeDerivedStages", () => {
  it("filters out omitted stages and preserves order otherwise", () => {
    const stages: DerivedStageInput[] = [
      stage({ key: "a", milestoneIds: ["m1"] }),
      stage({ key: "b", showWhenEmpty: false, milestoneIds: ["missing"] }),
      stage({ key: "c", milestoneIds: [] }),
    ];
    const out = computeDerivedStages(stages, [{ id: "m1", state: "done" }], pipelineStages);
    expect(out.map((s) => s.key)).toEqual(["a", "c"]);
  });
});
