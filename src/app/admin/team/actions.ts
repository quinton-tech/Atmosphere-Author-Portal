"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers } from "@/db/schema-team";
import { requireAdmin } from "@/lib/session";
import { audit, type AuditAction } from "@/lib/audit";
import { importTeamFromWebsite } from "@/lib/team/import";
import { redirectWithFlash, runAction } from "../_lib/flash";

const LIST_PATH = "/admin/team";
// mutation below casts to it in the meantime.
const TEAM_AUDIT_ACTION = "admin.team.import";

export async function importTeamAction(): Promise<void> {
  const admin = await requireAdmin();
  let result: Awaited<ReturnType<typeof importTeamFromWebsite>>;
  try {
    result = await importTeamFromWebsite(admin.id);
  } catch (e) {
    redirectWithFlash(LIST_PATH, "error", e instanceof Error ? e.message : "Import failed.");
  }
  redirectWithFlash(
    LIST_PATH,
    "ok",
    `Imported ${result.imported} new, updated ${result.updated}, skipped ${result.skippedLocked} locked (of ${result.total} on the site).`,
  );
}

const idSchema = z.string().uuid();

export async function toggleShowAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const memberId = idSchema.parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      const [row] = await db.select({ showToAuthors: teamMembers.showToAuthors }).from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
      if (!row) throw new Error("Team member not found.");
      const next = !row.showToAuthors;
      await db.update(teamMembers).set({ showToAuthors: next, updatedAt: new Date() }).where(eq(teamMembers.id, memberId));
      await audit(admin.id, TEAM_AUDIT_ACTION, { targetType: "team_member", targetId: memberId, meta: { action: "show_toggle", showToAuthors: next } });
    },
    "Updated.",
  );
}

export async function toggleLockAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const memberId = idSchema.parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      const [row] = await db.select({ locked: teamMembers.locked }).from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
      if (!row) throw new Error("Team member not found.");
      const next = !row.locked;
      await db.update(teamMembers).set({ locked: next, updatedAt: new Date() }).where(eq(teamMembers.id, memberId));
      await audit(admin.id, TEAM_AUDIT_ACTION, { targetType: "team_member", targetId: memberId, meta: { action: "lock_toggle", locked: next } });
    },
    "Updated.",
  );
}

const editSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(200).optional().default(""),
  whatIDo: z.string().trim().max(4000).optional().default(""),
});

/** Saving an edit always sets locked=true: a hand-edited row must survive the next import untouched. */
export async function editTeamMemberAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title") ?? "",
    whatIDo: formData.get("whatIDo") ?? "",
  });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid input.");

  await runAction(
    LIST_PATH,
    async () => {
      const d = parsed.data!;
      await db
        .update(teamMembers)
        .set({ title: d.title || null, whatIDo: d.whatIDo || null, locked: true, updatedAt: new Date() })
        .where(eq(teamMembers.id, d.id));
      await audit(admin.id, TEAM_AUDIT_ACTION, { targetType: "team_member", targetId: d.id, meta: { action: "edit" } });
    },
    "Saved.",
  );
}
