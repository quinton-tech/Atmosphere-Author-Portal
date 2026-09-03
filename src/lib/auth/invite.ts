import "server-only";
import { eq } from "drizzle-orm";
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
