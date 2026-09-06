/**
 * Postgres-backed fixed-window rate limiter.
 *
 * Previously an in-memory `Map` per limiter — fine for a single long-lived Node process, but
 * wrong for this app's actual deployment: it reset on every deploy/cold start and, worse, kept
 * separate counters per serverless instance, so the *effective* limit at N concurrent instances
 * was `max * N`, not `max`. This version stores one row per key in the `rate_limits` table
 * (src/db/schema-auth.ts) and updates it with a single atomic `INSERT ... ON CONFLICT DO UPDATE`,
 * so concurrent requests across any number of instances see one consistent counter.
 *
 * The `CASE` expressions below are the enforcement; `./rate-limit-core.ts`'s `nextRateLimitState`
 * mirrors the same logic in plain JS purely so it can be unit-tested without a database — it is
 * not itself part of the enforcement path.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema-auth";
import { toRateLimitResult, type RateLimitResult } from "./rate-limit-core";

export type { RateLimitResult } from "./rate-limit-core";

const ALWAYS_ALLOWED: RateLimitResult = { allowed: true, remaining: 0, retryAfterMs: 0 };

/**
 * Records one attempt for `key` and reports whether it's allowed, per `{ max, windowMs }`. Safe
 * to call concurrently for the same key from any number of instances.
 */
async function consumeRateLimit(key: string, opts: { max: number; windowMs: number }, now: Date = new Date()): Promise<RateLimitResult> {
  const freshWindowEnds = new Date(now.getTime() + opts.windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowEnds: freshWindowEnds })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowEnds} < now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowEnds: sql`CASE WHEN ${rateLimits.windowEnds} < now() THEN ${freshWindowEnds} ELSE ${rateLimits.windowEnds} END`,
      },
    })
    .returning({ count: rateLimits.count, windowEnds: rateLimits.windowEnds });

  return toRateLimitResult(row, opts.max, now);
}

/** 10 attempts / 15 minutes, per the auth brief. */
const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/** True if the login attempt for this email+ip pair should be blocked. Consumes both buckets
 *  (even when one already reports blocked) so a client can't learn which bucket tripped. */
export async function isLoginRateLimited(email: string, ip: string | null): Promise<boolean> {
  const [emailResult, ipResult] = await Promise.all([
    consumeRateLimit(`login:email:${email.toLowerCase()}`, LOGIN_LIMIT),
    ip ? consumeRateLimit(`login:ip:${ip}`, LOGIN_LIMIT) : Promise.resolve(ALWAYS_ALLOWED),
  ]);
  return !emailResult.allowed || !ipResult.allowed;
}

/**
 * "Forgot password" requests: unlike login, this endpoint takes no password, so it has no
 * meaningful failure signal to key off of — an unauthenticated caller can hit it repeatedly to
 * mail-bomb an address (each request sends an email) or run up the HIBP outbound-request count.
 * 5 requests / hour per address, 20/hour per IP (shared IPs — offices, NAT — get a looser cap).
 */
const RESET_EMAIL_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
const RESET_IP_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

/** True if this password-reset request should be blocked. Consumes both buckets. */
export async function isPasswordResetRateLimited(email: string, ip: string | null): Promise<boolean> {
  const [emailResult, ipResult] = await Promise.all([
    consumeRateLimit(`reset:email:${email.toLowerCase()}`, RESET_EMAIL_LIMIT),
    ip ? consumeRateLimit(`reset:ip:${ip}`, RESET_IP_LIMIT) : Promise.resolve(ALWAYS_ALLOWED),
  ]);
  return !emailResult.allowed || !ipResult.allowed;
}

/**
 * Admin TOTP verification: a 6-digit code is only ~1e6 combinations and (with the ±30s drift
 * window) up to 3 are valid at once, so this endpoint needs its own lockout independent of the
 * login rate limiter. 10 attempts / 15 minutes per already-authenticated admin user id.
 */
const TOTP_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

export async function isTotpRateLimited(userId: string): Promise<boolean> {
  const result = await consumeRateLimit(`totp:user:${userId}`, TOTP_LIMIT);
  return !result.allowed;
}
