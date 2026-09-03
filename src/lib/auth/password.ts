import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { sendPasswordResetEmail } from "./email";
import { PASSWORD_MIN_LENGTH, hashPassword, verifyPasswordHash, generateResetToken, hashResetToken } from "./password-core";
import type { Role } from "@/lib/types";

export { PASSWORD_MIN_LENGTH, hashPassword, verifyPasswordHash, generateResetToken, hashResetToken };

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

/** Consumes a `/reset-password?token=` link: validates, hashes, updates the user, deletes the token, audits. */
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

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
  await audit(row.userId, "auth.password_reset", { targetType: "user", targetId: row.userId });
  return { ok: true };
}

/**
 * Set/change password from the Account page. The caller (the account page's
 * own server action) is responsible for establishing `userId` via a verified
 * session — this function trusts the id it's given and does not re-derive it,
 * to avoid a circular import back through `@/auth`. Pass `currentPassword` to
 * require it match before changing (the "change password" case); omit it to
 * set a password for the first time (e.g. a magic-link-only account).
 */
export async function setPassword(
  userId: string,
  newPassword: string,
  opts: { currentPassword?: string } = {},
): Promise<PasswordResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, error: "Account not found." };

  if (opts.currentPassword !== undefined) {
    if (!user.passwordHash || !(await verifyPasswordHash(user.passwordHash, opts.currentPassword))) {
      return { ok: false, error: "Current password is incorrect." };
    }
  }

  const strength = await checkPasswordStrength(newPassword);
  if (!strength.ok) return strength;

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(userId, "auth.password_set", { targetType: "user", targetId: userId });
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
