/** Pure functions: map raw HubSpot properties to a stage key. No server deps, unit-testable. */
import type { StageConfig } from "@/db/schema";

export const STAGE_PROPERTY_FALLBACK = "pipelineStage"; // portal id; the HubSpot label is "Pipeline Stage"

/**
 * Resolve which stage_config row a Project's properties fall into.
 * Matching is case-insensitive on `hubspotValues`; a row whose `key` equals the raw value also matches.
 * Returns null if unmapped (UI shows "In production" and admin health flags it).
 */
export function resolveStageKey(
  properties: Record<string, string | null>,
  stages: Pick<StageConfig, "key" | "hubspotValues">[],
  stageProperty: string = STAGE_PROPERTY_FALLBACK,
): string | null {
  const raw = properties[stageProperty];
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  for (const s of stages) {
    if (s.key.toLowerCase() === needle) return s.key;
    if (s.hubspotValues.some((v) => v.trim().toLowerCase() === needle)) return s.key;
  }
  return null;
}
