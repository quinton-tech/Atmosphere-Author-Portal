import { describe, expect, it } from "vitest";
import { evaluateActionRules, ruleMatches, rulePropertyIsAvailable } from "./rules";
import type { ActionRule } from "@/db/schema";

function rule(over: Partial<ActionRule> & Pick<ActionRule, "propertyName" | "operator">): Pick<ActionRule, "propertyName" | "operator" | "value"> {
  return { value: null, ...over };
}

describe("ruleMatches", () => {
  it("matches against a portal-id-cached property, as before", () => {
    expect(ruleMatches(rule({ propertyName: "package", operator: "eq", value: "Premier" }), { package: "Premier" })).toBe(true);
    expect(ruleMatches(rule({ propertyName: "package", operator: "eq", value: "Premier" }), { package: "Standard" })).toBe(false);
  });

  it("falls back to the hs:<name> cache slot for a rule naming a raw HubSpot property (review finding #2)", () => {
    // `payment_status` isn't a portal property, so it's only ever cached namespaced as hs:payment_status
    // (via loadSyncConfig's extraProperties) — never under its own bare name.
    const props = { "hs:payment_status": "overdue" };
    expect(ruleMatches(rule({ propertyName: "payment_status", operator: "eq", value: "overdue" }), props)).toBe(true);
    expect(ruleMatches(rule({ propertyName: "payment_status", operator: "eq", value: "paid" }), props)).toBe(false);
  });

  it("prefers a portal-id value over an hs: shadow of the same name, if both are somehow present", () => {
    const props = { package: "Premier", "hs:package": "Standard" };
    expect(ruleMatches(rule({ propertyName: "package", operator: "eq", value: "Premier" }), props)).toBe(true);
  });

  it("still can't match a property that's cached nowhere at all", () => {
    expect(ruleMatches(rule({ propertyName: "payment_status", operator: "not_empty" }), {})).toBe(false);
  });
});

describe("rulePropertyIsAvailable", () => {
  it("is true for a portal id present in props, even with a null/empty value", () => {
    expect(rulePropertyIsAvailable("package", { package: null })).toBe(true);
  });

  it("is true for a raw HubSpot name cached under hs:<name>", () => {
    expect(rulePropertyIsAvailable("payment_status", { "hs:payment_status": null })).toBe(true);
  });

  it("is false when the property has no cached slot under either key", () => {
    expect(rulePropertyIsAvailable("payment_status", { package: "Premier" })).toBe(false);
  });
});

describe("evaluateActionRules", () => {
  it("evaluates enabled rules against whichever cache slot the property resolves to", () => {
    const rules = [
      {
        id: "r1",
        propertyName: "payment_status",
        operator: "eq" as const,
        value: "overdue",
        title: "Payment overdue",
        message: "",
        ctaLabel: null,
        ctaUrl: null,
        severity: "action",
        enabled: true,
        sortOrder: 0,
        updatedAt: new Date(),
      },
    ] as unknown as ActionRule[];
    const actions = evaluateActionRules({ "hs:payment_status": "overdue" }, rules);
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe("Payment overdue");
  });
});
