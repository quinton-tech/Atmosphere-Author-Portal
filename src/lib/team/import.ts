import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers } from "@/db/schema-team";
import { audit, type AuditAction } from "@/lib/audit";
import { fetchTeamPage } from "./fetch";
import { nameKey } from "./parse";
import { planTeamImport } from "./plan";

export type { ExistingTeamRow, TeamImportAction } from "./plan";
export { planTeamImport } from "./plan";

export type TeamImportResult = {
  imported: number;
  updated: number;
  skippedLocked: number;
  total: number;
  modified: string;
};

/**
 * Fetches the current team page and upserts by slug. Locked rows (admin hand-edited) keep their
 * content fields as-is but still get `importedAt` bumped, so "last import" reflects reality even
 * when every row is locked.
 */
export async function importTeamFromWebsite(actorId: string | null): Promise<TeamImportResult> {
  const { modified, members } = await fetchTeamPage();
  const existing = await db.select({ slug: teamMembers.slug, locked: teamMembers.locked }).from(teamMembers);
  const plan = planTeamImport(members, existing);

  let imported = 0;
  let updated = 0;
  let skippedLocked = 0;
  const now = new Date();

  for (const m of members) {
    const action = plan[m.slug];
    if (action === "insert") {
      await db.insert(teamMembers).values({
        slug: m.slug,
        name: m.name,
        title: m.title,
        departments: m.departments,
        photoUrl: m.photoUrl,
        whatIDo: m.whatIDo,
        background: m.background,
        whoIAm: m.whoIAm,
        nameKey: nameKey(m.name),
        importedAt: now,
        updatedAt: now,
      });
      imported++;
    } else if (action === "update") {
      await db
        .update(teamMembers)
        .set({
          name: m.name,
          title: m.title,
          departments: m.departments,
          photoUrl: m.photoUrl,
          whatIDo: m.whatIDo,
          background: m.background,
          whoIAm: m.whoIAm,
          nameKey: nameKey(m.name),
          importedAt: now,
          updatedAt: now,
        })
        .where(eq(teamMembers.slug, m.slug));
      updated++;
    } else {
      await db.update(teamMembers).set({ importedAt: now }).where(eq(teamMembers.slug, m.slug));
      skippedLocked++;
    }
  }

  const total = members.length;
  await audit(
    actorId,
    "admin.team.import",
    { targetType: "team_members", meta: { imported, updated, skippedLocked, total, modified } },
  );

  return { imported, updated, skippedLocked, total, modified };
}
