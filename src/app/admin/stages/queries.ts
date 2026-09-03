import "server-only";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookCache, stageConfig } from "@/db/schema";

export async function listStages() {
  return db.select().from(stageConfig).orderBy(asc(stageConfig.sortOrder));
}

/** Distinct raw `pipelineStage` values seen in book_cache that no stage_config row claims. */
export async function listUnmappedStageValues(): Promise<string[]> {
  const stages = await listStages();
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
