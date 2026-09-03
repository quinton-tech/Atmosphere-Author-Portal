/**
 * Pure cookie-naming and 2FA-cookie-signing helpers. No `next/headers`, no DB —
 * safe to import from `src/proxy.ts` (which uses the `NextRequest`/`NextResponse`
 * cookie APIs, not `next/headers`) as well as from server actions and pages.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** True when cookies should carry the `__Secure-` prefix (matches @auth/core's own rule). */
export function secureCookiesEnabled(): boolean {
  return env.NODE_ENV === "production" || (env.AUTH_URL?.startsWith("https://") ?? false);
}

/**
 * Name of the Auth.js database-session cookie. We piggyback on this exact name
 * (rather than inventing our own) so that a session we create ourselves — for
 * password sign-in, see `db-session.ts` — is read back correctly by `auth()`,
 * which asks the Drizzle adapter for a session row matching the cookie value.
 */
export function sessionCookieName(): string {
  return `${secureCookiesEnabled() ? "__Secure-" : ""}authjs.session-token`;
}

/** httpOnly cookie marking "this session's admin has completed 2FA today." */
export const TWO_FA_COOKIE_NAME = "ap_2fa";

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Signed HMAC of `sessionToken:day` — unusable after midnight UTC or against a different session. */
export function signTwoFactorCookie(sessionToken: string, date: Date = new Date()): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`${sessionToken}:${dayStamp(date)}`).digest("hex");
}

export function isTwoFactorCookieValid(
  cookieValue: string | null | undefined,
  sessionToken: string | null | undefined,
  date: Date = new Date(),
): boolean {
  if (!cookieValue || !sessionToken) return false;
  const expected = signTwoFactorCookie(sessionToken, date);
  const a = Buffer.from(expected);
  const b = Buffer.from(cookieValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
