import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { sendPasswordChangedEmail, sendPasswordResetEmail } from "./email";
import { revokeOtherSessions } from "./db-session";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT, hashPassword, verifyPasswordHash, generateResetToken, hashResetToken } from "./password-core";
import type { Role } from "@/lib/types";

export { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT, hashPassword, verifyPasswordHash, generateResetToken, hashResetToken };

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** How recently a magic-link-only user must have signed in to set a first password without
 *  re-verifying one (there's no password to re-verify). See `setPassword`. */
const REAUTH_WINDOW_MS = 30 * 60 * 1000;

async function resolveAppUrl(): Promise<string> {
  if (env.AUTH_URL) return env.AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Public entry point for the "forgot password" form. Always resolves; never
 * reveals whether the address exists (matches the magic-link no-enumeration rule).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim();
  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!user || user.disabledAt) return;

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await db.insert(passwordResetTokens).values({ tokenHash, userId: user.id, expires });

  const base = await resolveAppUrl();
  const url = `${base}/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, url);
}

export type PasswordResult = { ok: true } | { ok: false; error: string };

async function checkPasswordStrength(password: string): Promise<PasswordResult> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (await isPwnedPassword(password)) {
    return { ok: false, error: "That password has appeared in a data breach. Please choose a different one." };
  }
  return { ok: true };
}

/**
 * Have I Been Pwned range API, k-anonymity model: we only ever send the first
 * 5 hex chars of the SHA-1 hash, never the password or the full hash.
 * Fails open (treats the password as not-pwned) on any network error, per brief.
 */
async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0]?.trim() === suffix);
  } catch {
    return false;
  }
}

/**
 * Consumes a `/reset-password?token=` link: validates, hashes, updates the user, then — since a
 * reset means "prove you own the account by email, because you couldn't sign in" — revokes every
 * outstanding reset token and every existing session for that user (there's no "current session"
 * to preserve here; the reset-password page sends the user to `/sign-in` to get a fresh one) and
 * emails a "your password was changed" notice.
 */
export async function resetPassword(token: string, newPassword: string): Promise<PasswordResult> {
  const tokenHash = hashResetToken(token);
  const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  if (!row) return { ok: false, error: "This link is invalid or has already been used." };
  if (row.expires.getTime() < Date.now()) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
    return { ok: false, error: "This link has expired. Request a new one." };
  }

  const strength = await checkPasswordStrength(newPassword);
  if (!strength.ok) return strength;

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user) return { ok: false, error: "Account not found." };

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));
  await revokeOtherSessions(row.userId, null);
  await audit(row.userId, "auth.password_reset", { targetType: "user", targetId: row.userId });
  await sendPasswordChangedEmail(user.email, await resolveAppUrl().then((b) => `${b}/sign-in`)).catch(() => {});
  return { ok: true };
}

export type SetPasswordErrorCode = "wrong_current" | "reauth" | "weak" | "error";
export type SetPasswordResult = { ok: true } | { ok: false; code: SetPasswordErrorCode; error: string };

/** True if this user already has a password set (vs. magic-link only). For the Account page to
 *  decide whether to render/require the "Current password" field. */
export async function hasPasswordHash(userId: string): Promise<boolean> {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  return !!user?.passwordHash;
}

/**
 * Set/change password from the Account page. The caller (the account page's own server action)
 * is responsible for establishing `userId` via a verified session — this function trusts the id
 * it's given and does not re-derive it, to avoid a circular import back through `@/auth`.
 *
 * - If the account already has a password, `opts.currentPassword` is REQUIRED and must verify
 *   (`wrong_current` otherwise) — there is no other proof of identity for a password change.
 * - If the account is magic-link-only (no password yet), there's no current password to check,
 *   so instead the caller's session must have been established recently — `users.lastLoginAt`
 *   within `REAUTH_WINDOW_MS` — else `reauth`, asking them to sign in again first. (The `sessions`
 *   table only stores `expires`, not `createdAt`, so `lastLoginAt` is the best proxy we have.)
 *
 * On success: revokes every OTHER session for the user (pass `opts.currentSessionToken` to keep
 * the caller's own session alive), deletes all outstanding password-reset tokens, and emails a
 * "your password was changed" notice.
 */
export async function setPassword(
  userId: string,
  newPassword: string,
  opts: { currentPassword?: string; currentSessionToken?: string | null } = {},
): Promise<SetPasswordResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, code: "error", error: "Account not found." };

  if (user.passwordHash) {
    if (!opts.currentPassword || !(await verifyPasswordHash(user.passwordHash, opts.currentPassword))) {
      return { ok: false, code: "wrong_current", error: "Current password is incorrect." };
    }
  } else {
    const recent = !!user.lastLoginAt && Date.now() - user.lastLoginAt.getTime() <= REAUTH_WINDOW_MS;
    if (!recent) {
      return { ok: false, code: "reauth", error: "For your security, please sign in again before setting a password." };
    }
  }

  const strength = await checkPasswordStrength(newPassword);
  if (!strength.ok) return { ok: false, code: "weak", error: strength.error };

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await revokeOtherSessions(userId, opts.currentSessionToken ?? null);
  await audit(userId, "auth.password_set", { targetType: "user", targetId: userId });
  await sendPasswordChangedEmail(user.email, await resolveAppUrl().then((b) => `${b}/sign-in`)).catch(() => {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Login verification — shared by the Credentials provider's authorize() and
// by the custom password sign-in server action (see src/app/(auth)/sign-in).
// ---------------------------------------------------------------------------

export type AuthenticatedUser = { id: string; email: string; name: string | null; role: Role };

/** Verifies email+password. Returns null on any failure (wrong password, disabled, no such user) without saying which. */
export async function verifyPasswordLogin(email: string, password: string): Promise<AuthenticatedUser | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim())).limit(1);
  if (!user || user.disabledAt || !user.passwordHash) return null;
  const ok = await verifyPasswordHash(user.passwordHash, password);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
