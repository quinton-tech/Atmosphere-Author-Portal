/**
 * Creates and reads the Auth.js database-session cookie ourselves.
 *
 * Why this exists: Auth.js v5's Credentials provider always issues a JWT
 * session, even when `session.strategy` is "database" — confirmed by reading
 * `@auth/core`'s callback handler (`lib/actions/callback/index.js`): the
 * `credentials` branch calls `jwt.encode` unconditionally and never touches
 * `adapter.createSession`. That's a documented Auth.js limitation, not a
 * config mistake. Since the brief requires *revocable* database sessions for
 * password sign-in too ("so admins can revoke"), the password sign-in action
 * bypasses `signIn("credentials", …)` for the actual cookie and instead
 * writes a `sessions` row + cookie itself, using the exact cookie name and
 * shape Auth.js's own adapter flow uses — so `auth()` (which just asks the
 * adapter for a session matching the cookie value) reads it back identically
 * to a magic-link session. `forceSignOut`/`revokeAccess` (delete-by-userId)
 * then work uniformly regardless of how the user signed in.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { sessionCookieName, secureCookiesEnabled, TWO_FA_COOKIE_NAME, signTwoFactorCookie } from "./cookies";

export { TWO_FA_COOKIE_NAME, signTwoFactorCookie, isTwoFactorCookieValid, sessionCookieName } from "./cookies";

/** Matches @auth/core's default `session.maxAge` (30 days). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function createDatabaseSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({ sessionToken: token, userId, expires });
  return { token, expires };
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    expires,
  });
}

/** Reads the raw session token from the incoming request's cookie jar. */
export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(sessionCookieName())?.value;
}

/** Marks the current admin's session as 2FA-verified for the rest of today (UTC). */
export async function markTwoFactorVerified(sessionToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(TWO_FA_COOKIE_NAME, signTwoFactorCookie(sessionToken), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    maxAge: 60 * 60 * 24, // 1 day — matches the daily signature, so it just stops validating tomorrow
  });
}
