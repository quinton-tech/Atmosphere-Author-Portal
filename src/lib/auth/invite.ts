import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { signIn } from "@/auth";

/**
 * Sends (or re-sends) the magic-link sign-in email via the Resend provider's
 * own flow, so behaviour matches self-serve "send me a link" exactly — same
 * 15-minute expiry, same on-brand template, same silent no-op if the target
 * turns out to be missing/disabled by the time Auth.js processes it.
 */
async function sendInviteEmail(email: string): Promise<void> {
  await signIn("resend", { email, redirectTo: "/dashboard", redirect: false });
}

/**
 * Creates the user row if one doesn't exist for this email, then sends the
 * magic-link invite. Re-inviting a previously revoked (`disabledAt` set)
 * author re-enables them — an admin choosing to invite someone again is
 * assumed to mean "let them back in."
 */
export async function inviteAuthor(input: {
  email: string;
  name: string | null;
  hubspotContactId?: string | null;
  invitedById: string;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!existing) {
    await db.insert(users).values({
      email,
      name: input.name,
      hubspotContactId: input.hubspotContactId ?? null,
      role: "author",
      invitedById: input.invitedById,
      invitedAt: new Date(),
    });
  } else {
    await db
      .update(users)
      .set({
        disabledAt: null,
        invitedById: existing.invitedAt ? existing.invitedById : input.invitedById,
        invitedAt: existing.invitedAt ?? new Date(),
        name: existing.name ?? input.name,
        hubspotContactId: existing.hubspotContactId ?? input.hubspotContactId ?? null,
      })
      .where(eq(users.id, existing.id));
  }

  await sendInviteEmail(email);
}

export async function resendInvite(userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Author not found.");
  if (user.disabledAt) {
    await db.update(users).set({ disabledAt: null }).where(eq(users.id, userId));
  }
  await sendInviteEmail(user.email);
}

/** Disables sign-in for this user and immediately kills every active session. */
export async function revokeAccess(userId: string): Promise<void> {
  await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Deletes every database session for this user, forcing a fresh sign-in everywhere. */
export async function forceSignOut(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Count of other active (role admin, not disabled) admins, excluding `excludingUserId`. */
async function countOtherActiveAdmins(excludingUserId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.disabledAt), ne(users.id, excludingUserId)));
  return rows.length;
}

/**
 * `revokeAccess`, guarded for the admin panel: refuses to let an admin revoke their own account
 * (which would immediately sign them out of the very panel they're using) and refuses to revoke
 * the last remaining active admin (which would lock every admin out of `/admin` — nothing short
 * of direct DB access could undo it). Defence in depth alongside the same checks in
 * `src/app/admin/authors/actions.ts`.
 */
export async function adminRevokeAccess(userId: string, actingAdminId: string): Promise<void> {
  if (userId === actingAdminId) {
    throw new Error("You can't revoke your own access. Ask another admin to do it.");
  }
  const [target] = await db.select({ role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new Error("Author not found.");
  if (target.role === "admin" && !target.disabledAt) {
    const others = await countOtherActiveAdmins(userId);
    if (others < 1) throw new Error("You can't revoke the last remaining admin.");
  }
  await revokeAccess(userId);
}

/**
 * `forceSignOut`, guarded for the admin panel: refuses to let an admin force-sign-out their own
 * account from the Authors table (that would kill their own session mid-workflow with no
 * confirmation). Self-service "sign out everywhere" on the Account page calls `forceSignOut`
 * directly and is unaffected — that's an intentional self-service action, not this guard's target.
 */
export async function adminForceSignOut(userId: string, actingAdminId: string): Promise<void> {
  if (userId === actingAdminId) {
    throw new Error('You can\'t force-sign-out your own account from here — use "Sign out everywhere" on your Account page instead.');
  }
  await forceSignOut(userId);
}
