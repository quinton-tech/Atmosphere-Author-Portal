/**
 * Pure upsert-planning for the team import — no DB, no `server-only` deps, so it's directly
 * testable (see import.test.ts). src/lib/team/import.ts does the actual DB read/write around this.
 */
import type { TeamMemberImport } from "./parse";

export type ExistingTeamRow = { slug: string; locked: boolean };

export type TeamImportAction = "insert" | "update" | "skip_locked";

/**
 * Given the freshly-fetched members and which slugs already exist (and whether an admin has
 * locked them), decide what to do with each row, keyed by slug.
 */
export function planTeamImport(incoming: TeamMemberImport[], existing: ExistingTeamRow[]): Record<string, TeamImportAction> {
  const existingBySlug = new Map(existing.map((e) => [e.slug, e]));
  const plan: Record<string, TeamImportAction> = {};
  for (const m of incoming) {
    const row = existingBySlug.get(m.slug);
    plan[m.slug] = !row ? "insert" : row.locked ? "skip_locked" : "update";
  }
  return plan;
}
