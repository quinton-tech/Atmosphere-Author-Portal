/**
 * Pure: build an author-facing timeline from cached Project properties.
 * The Atmosphere pipeline is NOT strictly linear (stages can repeat, double back, or run in
 * parallel), so the timeline is event-based: every dated property becomes an event, the
 * current Pipeline Stage is highlighted, and the "typical path" is shown only as context.
 */
import type { StageConfig } from "@/db/schema";
import type { TeamMember, TimelineEvent } from "@/lib/types";
import { TEAM_ROLES } from "./properties";

export type DisplayLabels = Record<string, Record<string, string>>; // propertyId -> raw -> friendly

export function friendly(propertyId: string, raw: string | null | undefined, labels: DisplayLabels): string | null {
  if (raw == null || raw === "") return null;
  const hit = labels[propertyId]?.[raw] ?? labels[propertyId]?.[raw.trim().toLowerCase()];
  if (hit) return hit;
  // Prettify snake_case / SCREAMING_CASE dropdown values as a fallback.
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Teaser fields sometimes carry several labelled blocks ("HARDCOVER FLAP TEXT: …"). Keep the first. */
export function cleanTeaser(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/\s+[A-Z][A-Z' ]{4,}:\s+/)[0]?.trim();
  return first || null;
}

/** Owner ids that couldn't be resolved to a name (missing owners scope) must never reach an author. */
export function displayPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  return /^\d+$/.test(v) ? "Assigned" : v;
}

export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  // HubSpot date properties arrive as ms epoch strings or ISO dates.
  const n = Number(v);
  const d = Number.isFinite(n) && v.trim() !== "" ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildTeam(props: Record<string, string | null>, labels: DisplayLabels): TeamMember[] {
  const out: TeamMember[] = [];
  for (const r of TEAM_ROLES) {
    const name = displayPersonName(props[r.person]);
    if (!name) continue;
    const assigned = "assigned" in r ? parseDate(props[r.assigned]) : null;
    const status = "status" in r ? friendly(r.status, props[r.status], labels) : null;
    out.push({ role: r.role, name, assignedAt: assigned?.toISOString() ?? null, status });
  }
  return out;
}

export function buildTimeline(
  props: Record<string, string | null>,
  stages: Pick<StageConfig, "key" | "label">[],
  currentStageKey: string | null,
  labels: DisplayLabels,
  now: Date = new Date(),
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (id: string, at: Date | null, title: string, detail: string | null, kind: TimelineEvent["kind"]) => {
    if (!at) return;
    events.push({ id, at: at.toISOString(), title, detail, kind, isFuture: at.getTime() > now.getTime() });
  };

  push("initiation", parseDate(props.initiationDate), "Your project began", friendly("package", props.package, labels), "milestone");

  for (const r of TEAM_ROLES) {
    if (!("assigned" in r)) continue;
    const at = parseDate(props[r.assigned]);
    const name = displayPersonName(props[r.person]);
    const nameDetail = name === "Assigned" ? null : name;
    const status = "status" in r ? friendly(r.status, props[r.status], labels) : null;
    push(r.assigned, at, `${r.role} assigned`, [nameDetail, status].filter(Boolean).join(" · ") || null, "assignment");
  }

  push("publication", parseDate(props.publicationDate), "Publication", null, "milestone");

  events.sort((a, b) => a.at.localeCompare(b.at));

  // Current stage marker sits at "now" so it reads as the present moment on the line.
  const current = stages.find((s) => s.key === currentStageKey);
  if (current) {
    events.push({
      id: "current-stage",
      at: now.toISOString(),
      title: `Now: ${current.label}`,
      detail: null,
      kind: "current",
      isFuture: false,
    });
    events.sort((a, b) => a.at.localeCompare(b.at));
  }
  return events;
}
