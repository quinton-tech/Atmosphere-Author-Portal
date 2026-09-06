import "server-only";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookCache, stageConfig, stageMilestones } from "@/db/schema";

export async function listStages() {
  return db.select().from(stageConfig).orderBy(asc(stageConfig.sortOrder));
}

export async function listMilestonesForSelect() {
  return db
    .select({ id: stageMilestones.id, label: stageMilestones.label, stageKey: stageMilestones.stageKey })
    .from(stageMilestones)
    .orderBy(asc(stageMilestones.sortOrder));
}

/**
 * Distinct raw `pipelineStage` values seen in book_cache that no stage_config row claims. Only
 * "pipeline" rows can claim a raw HubSpot value — "derived" rows have no HubSpot mapping (their
 * `hubspotValues` is always empty) and must never suppress a genuinely unmapped value here.
 */
export async function listUnmappedStageValues(): Promise<string[]> {
  const stages = (await listStages()).filter((s) => s.kind !== "derived");
  const known = new Set<string>();
  for (const s of stages) {
    known.add(s.key.trim().toLowerCase());
    for (const v of s.hubspotValues) known.add(v.trim().toLowerCase());
  }
  const result = await db.execute<{ value: string | null }>(
    sql`SELECT DISTINCT ${bookCache.properties}->>'pipelineStage' AS value FROM ${bookCache} WHERE ${bookCache.properties}->>'pipelineStage' IS NOT NULL`,
  );
  const out: string[] = [];
  for (const r of result.rows) {
    if (r.value && !known.has(r.value.trim().toLowerCase())) out.push(r.value);
  }
  return out;
}
