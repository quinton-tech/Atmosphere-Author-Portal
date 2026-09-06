"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, VIEW_AS_COOKIE } from "@/lib/session";
import { secureCookiesEnabled } from "@/lib/auth/cookies";
import { audit } from "@/lib/audit";
import { redirectWithFlash, runAction } from "../_lib/flash";
import { inviteAuthor, resendInvite } from "../_integrations";
import { adminRevokeAccess, adminForceSignOut } from "@/lib/auth/invite";

export type ActionState = { error?: string; ok?: string };

const LIST_PATH = "/admin/authors";
const emailSchema = z.string().trim().toLowerCase().email();
const userIdSchema = z.string().uuid();

export async function inviteNewAuthorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ email: emailSchema, name: z.string().trim().max(200).optional() })
    .safeParse({ email: formData.get("email"), name: formData.get("name") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await inviteAuthor({ email: parsed.data.email, name: parsed.data.name ?? null, invitedById: admin.id });
    await audit(admin.id, "admin.invite", { targetType: "user", meta: { email: parsed.data.email } });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send invite." };
  }
  redirectWithFlash(LIST_PATH, "ok", `Invited ${parsed.data.email}.`);
}

export async function inviteRowAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const id = userIdSchema.parse(userId);
  await runAction(
    LIST_PATH,
    async () => {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!row) throw new Error("Author not found.");
      await inviteAuthor({ email: row.email, name: row.name, hubspotContactId: row.hubspotContactId, invitedById: admin.id });
      await audit(admin.id, "admin.invite", { targetType: "user", targetId: id });
    },
    "Invite sent.",
  );
}

export async function resendInviteAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const id = userIdSchema.parse(userId);
  await runAction(
    LIST_PATH,
    async () => {
      await resendInvite(id);
      await audit(admin.id, "admin.resend_invite", { targetType: "user", targetId: id });
    },
    "Invite resent.",
  );
}

export async function revokeAccessAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const id = userIdSchema.parse(userId);
  if (id === admin.id) {
    redirectWithFlash(LIST_PATH, "error", "You can't revoke your own access. Ask another admin to do it.");
  }
  await runAction(
    LIST_PATH,
    async () => {
      await adminRevokeAccess(id, admin.id);
      await audit(admin.id, "admin.revoke_access", { targetType: "user", targetId: id });
    },
    "Access revoked.",
  );
}

export async function forceSignOutAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const id = userIdSchema.parse(userId);
  if (id === admin.id) {
    redirectWithFlash(LIST_PATH, "error", 'You can\'t force-sign-out your own account from here — use "Sign out everywhere" on your Account page instead.');
  }
  await runAction(
    LIST_PATH,
    async () => {
      await adminForceSignOut(id, admin.id);
      await audit(admin.id, "admin.force_signout", { targetType: "user", targetId: id });
    },
    "Signed out everywhere.",
  );
}

/** Sets the view-as cookie, audits, and redirects into the author-facing portal. */
export async function viewAsAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const id = userIdSchema.parse(userId);
  const jar = await cookies();
  jar.set(VIEW_AS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
  });
  await audit(admin.id, "admin.view_as", { targetType: "user", targetId: id });
  redirect("/dashboard");
}
