/** Pure functions: evaluate admin-defined action rules against Project properties. */
import type { ActionRule } from "@/db/schema";
import type { ActionItem } from "@/lib/types";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function ruleMatches(rule: Pick<ActionRule, "propertyName" | "operator" | "value">, props: Record<string, string | null>): boolean {
  const actual = norm(props[rule.propertyName]);
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
