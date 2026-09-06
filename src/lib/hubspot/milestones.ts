/**
 * Pure functions: evaluate admin-defined sub-stage "milestones" against Project properties.
 * Milestones reference raw HubSpot internal property names, cached namespaced as "hs:<name>"
 * (see plan.ts) so they never collide with the portal-id-keyed properties from properties.ts.
 * Package/Service-Add-ons are portal properties ("package" / "serviceAddOns"), still cached
 * under their portal ids.
 */
import type { StageConfig, StageMilestone, MilestoneIncludeRule, MilestoneRuleOperator } from "@/db/schema";
import type { MilestoneView } from "@/lib/types";
import { friendly, parseDate, type DisplayLabels } from "./timeline";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function splitMulti(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(";")
    .map((s) => norm(s))
    .filter(Boolean);
}

function formatDateShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
}

function propertyRuleMatches(rule: { name: string; operator: MilestoneRuleOperator; value?: string | string[] }, props: Record<string, string | null>): boolean {
  const actual = norm(props[`hs:${rule.name}`]);
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
    case "contains":
      return list.length > 0 && list.some((v) => splitMulti(actual).includes(v));
    default:
      return false;
  }
}

/** Inclusion: rule null -> everyone. Otherwise included if ANY listed condition matches. */
function isIncluded(rule: MilestoneIncludeRule, props: Record<string, string | null>): boolean {
  if (!rule) return true;
  const pkg = norm(props.package);
  if (rule.packages?.length && rule.packages.some((p) => norm(p) === pkg)) return true;
  if (rule.addOns?.length) {
    const addOns = splitMulti(props.serviceAddOns);
    if (rule.addOns.some((a) => addOns.includes(norm(a)))) return true;
  }
  if (rule.property && propertyRuleMatches(rule.property, props)) return true;
  return false;
}

type MilestoneRow = Pick<
  StageMilestone,
  | "id"
  | "stageKey"
  | "label"
  | "description"
  | "propertyName"
  | "kind"
  | "doneValues"
  | "hiddenValues"
  | "inProgressValues"
  | "linkProperty"
  | "dateProperty"
  | "venueProperty"
  | "includeRule"
  | "sortOrder"
  | "enabled"
> & {
  /** Admin-configured link text template, e.g. "Read your {venue} review". Optional: another
   *  migration is adding this column to stage_milestones alongside the row's other fields. */
  linkLabel?: string | null;
};

export function evaluateMilestones(
  props: Record<string, string | null>,
  milestoneRows: MilestoneRow[],
  stages: Pick<StageConfig, "key" | "label" | "sortOrder">[],
  labels: DisplayLabels,
  now: Date = new Date(),
): MilestoneView[] {
  const stageByKey = new Map(stages.map((s) => [s.key, s]));
  const ranked: { sortKey: [number, number]; view: MilestoneView }[] = [];

  for (const m of milestoneRows) {
    if (!m.enabled) continue;
    const stage = stageByKey.get(m.stageKey);
    if (!stage) continue;

    const rawValue = props[`hs:${m.propertyName}`];
    const normalizedValue = norm(rawValue);
    const hasValue = normalizedValue !== "";

    const hiddenValues = (m.hiddenValues ?? []).map(norm);
    if (hasValue && hiddenValues.includes(normalizedValue)) continue; // "not happening" -> omit entirely

    const included = isIncluded(m.includeRule, props);
    if (!included && !hasValue) continue; // shown if included, OR data says otherwise

    let state: MilestoneView["state"];
    let ownDate: Date | null = null;
    if (m.kind === "date") {
      ownDate = parseDate(rawValue);
      state = !ownDate ? "pending" : ownDate.getTime() <= now.getTime() ? "done" : "scheduled";
    } else if (m.kind === "flag") {
      state = normalizedValue === "true" || normalizedValue === "yes" ? "done" : "pending";
    } else {
      const doneValues = (m.doneValues ?? []).map(norm);
      const inProgressValues = m.inProgressValues?.map(norm);
      if (doneValues.includes(normalizedValue)) state = "done";
      else if (!hasValue) state = "pending";
      else if (inProgressValues) state = inProgressValues.includes(normalizedValue) ? "in_progress" : "pending";
      else state = "in_progress";
    }

    const linkedDate = m.dateProperty ? parseDate(props[`hs:${m.dateProperty}`]) : null;

    let detail: string | null;
    if (m.kind === "date") {
      detail = ownDate ? formatDateShort(ownDate) : null;
    } else {
      const statusText = m.kind === "flag" ? null : friendly(m.propertyName, rawValue, labels);
      const dateText = linkedDate ? formatDateShort(linkedDate) : null;
      detail = [statusText, dateText].filter(Boolean).join(" · ") || null;
    }

    const venueRaw = m.venueProperty ? props[`hs:${m.venueProperty}`] : null;
    const venueLabel = venueRaw ? (friendly(m.venueProperty!, venueRaw, labels) ?? venueRaw) : null;

    const linkRaw = m.linkProperty ? props[`hs:${m.linkProperty}`] : null;
    const href = linkRaw && /^https?:\/\//i.test(linkRaw.trim()) ? linkRaw.trim() : null;

    // Null whenever there's no link to show, regardless of a configured label — a link label with
    // nothing to link to would be dead text. Otherwise an admin-configured template (with "{venue}"
    // filled in) wins, falling back to a generic "View".
    const linkLabel = !href ? null : m.linkLabel ? m.linkLabel.replaceAll("{venue}", venueLabel ?? "") : "View";

    const at = (ownDate ?? linkedDate)?.toISOString() ?? null;

    ranked.push({
      sortKey: [stage.sortOrder, m.sortOrder],
      view: {
        id: m.id,
        stageKey: stage.key,
        stageLabel: stage.label,
        label: venueLabel ? `${m.label} · ${venueLabel}` : m.label,
        description: m.description,
        kind: m.kind,
        state,
        detail,
        at,
        href,
        linkLabel,
      },
    });
  }

  ranked.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1]);
  return ranked.map((r) => r.view);
}
