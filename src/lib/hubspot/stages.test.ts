import { describe, expect, it } from "vitest";
import { resolveStageKey } from "./stages";
import { evaluateActionRules, ruleMatches } from "./rules";
import type { ActionRule } from "@/db/schema";

const stages = [
  { key: "editorial", hubspotValues: ["Editing", "In Edit"] },
  { key: "cover_design", hubspotValues: ["Cover"] },
];

describe("resolveStageKey", () => {
  it("matches raw values case-insensitively", () => {
    expect(resolveStageKey({ stage: "editing" }, stages, "stage")).toBe("editorial");
    expect(resolveStageKey({ stage: " COVER " }, stages, "stage")).toBe("cover_design");
  });
  it("matches the key itself", () => {
    expect(resolveStageKey({ stage: "cover_design" }, stages, "stage")).toBe("cover_design");
  });
  it("returns null when unmapped or missing", () => {
    expect(resolveStageKey({ stage: "Unknown" }, stages, "stage")).toBeNull();
    expect(resolveStageKey({}, stages, "stage")).toBeNull();
  });
  it("ignores derived rows, even when one would otherwise match first", () => {
    const withDerivedFirst = [
      { key: "cover_design", hubspotValues: ["Cover"], kind: "derived" as const },
      { key: "editorial", hubspotValues: ["Editing", "In Edit"] },
    ];
    // Without the derived-row guard this would incorrectly match the first (derived) row by key.
    expect(resolveStageKey({ stage: "cover" }, withDerivedFirst, "stage")).toBeNull();
    expect(resolveStageKey({ stage: "cover_design" }, withDerivedFirst, "stage")).toBeNull();
  });
});

function rule(over: Partial<ActionRule>): ActionRule {
  return {
    id: "r1",
    propertyName: "payment_status",
    operator: "eq",
    value: "installment_due",
    title: "Your next installment is due",
    message: "",
    ctaLabel: "Pay now",
    ctaUrl: "https://example.com/pay",
    severity: "action",
    enabled: true,
    sortOrder: 0,
    updatedAt: new Date(),
    ...over,
  };
}

describe("action rules", () => {
  it("eq / neq", () => {
    expect(ruleMatches(rule({}), { payment_status: "Installment_Due" })).toBe(true);
    expect(ruleMatches(rule({ operator: "neq" }), { payment_status: "paid" })).toBe(true);
  });
  it("in / not_in / empty / not_empty", () => {
    expect(ruleMatches(rule({ operator: "in", value: ["a", "b"] }), { payment_status: "B" })).toBe(true);
    expect(ruleMatches(rule({ operator: "not_in", value: ["a"] }), { payment_status: "" })).toBe(false);
    expect(ruleMatches(rule({ operator: "empty", value: null }), {})).toBe(true);
    expect(ruleMatches(rule({ operator: "not_empty", value: null }), { payment_status: "x" })).toBe(true);
  });
  it("evaluates, filters disabled, sorts", () => {
    const out = evaluateActionRules({ payment_status: "installment_due", manuscript: "" }, [
      rule({ id: "b", sortOrder: 2 }),
      rule({ id: "off", enabled: false }),
      rule({ id: "a", sortOrder: 1, propertyName: "manuscript", operator: "empty", value: null, title: "Send your manuscript", severity: "info" }),
    ]);
    expect(out.map((a) => a.id)).toEqual(["a", "b"]);
    expect(out[0].severity).toBe("info");
  });
});
