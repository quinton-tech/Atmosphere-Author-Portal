/** Pure functions: evaluate admin-defined action rules against Project properties. */
import type { ActionRule } from "@/db/schema";
import type { ActionItem } from "@/lib/types";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/**
 * Resolve a rule's configured property to its cached value. `rule.propertyName` may name either a
 * portal id (e.g. "package", cached as-is by `pickPortalProperties`) or a raw HubSpot internal
 * property name that isn't one of the portal's displayed properties (e.g. "payment_status") — those
 * are cached namespaced as `hs:<name>` alongside milestone-driving properties (see
 * `loadSyncConfig`'s `extraProperties` in sync.ts). Portal ids win when both happen to be present.
 */
function resolveRuleValue(propertyName: string, props: Record<string, string | null>): string | null | undefined {
  return props[propertyName] ?? props[`hs:${propertyName}`];
}

/**
 * True if `propertyName` has a cached slot at all (portal id or `hs:<name>`), regardless of
 * whether its value is empty. Lets the admin rule editor warn "this property has no cached value
 * yet" for a rule that can structurally never match (see rulePropertyIsAvailable's caller).
 */
export function rulePropertyIsAvailable(propertyName: string, props: Record<string, string | null>): boolean {
  return propertyName in props || `hs:${propertyName}` in props;
}

export function ruleMatches(rule: Pick<ActionRule, "propertyName" | "operator" | "value">, props: Record<string, string | null>): boolean {
  const actual = norm(resolveRuleValue(rule.propertyName, props));
  const expected = rule.value;
  const list = Array.isArray(expected) ? expected.map(norm) : expected == null ? [] : [norm(expected)];
  switch (rule.operator) {
    case "eq":
      return list.length > 0 && actual === list[0];
    case "neq":
      return list.length > 0 && actual !== list[0];
    case "in":
      return list.includes(actual);
    case "not_in":
      return actual !== "" && !list.includes(actual);
    case "empty":
      return actual === "";
    case "not_empty":
      return actual !== "";
    default:
      return false;
  }
}

export function evaluateActionRules(props: Record<string, string | null>, rules: ActionRule[]): ActionItem[] {
  return rules
    .filter((r) => r.enabled && ruleMatches(r, props))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      ctaLabel: r.ctaLabel,
      ctaUrl: r.ctaUrl,
      severity: r.severity === "info" ? "info" : "action",
    }));
}
