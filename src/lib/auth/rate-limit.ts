/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Good enough for a single Node.js server process. It resets on deploy/restart
 * and does not share state across serverless instances — fine for the login
 * rate limits we use it for today (10 attempts / 15 min per email and per IP),
 * but if this app moves to multi-instance serverless, swap this for a shared
 * store (Upstash/Redis) keyed the same way. No DB dependency so it's cheap to
 * unit test.
 */

export type RateLimitResult = {
  /** Whether this attempt is allowed. */
  allowed: boolean;
  /** Attempts remaining in the current window, after this check. */
  remaining: number;
  /** Milliseconds until the window resets, if blocked. */
  retryAfterMs: number;
};

export interface RateLimiter {
  /** Records an attempt for `key` and reports whether it was allowed. */
  consume(key: string, now?: number): RateLimitResult;
  /** Reports the current state for `key` without recording an attempt. */
  peek(key: string, now?: number): RateLimitResult;
  /** Clears any record for `key` (e.g. after a successful login). */
  reset(key: string): void;
  /** Number of tracked keys. Exposed for tests / diagnostics only. */
  size(): number;
}

type Bucket = { count: number; windowStart: number };

export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function currentBucket(key: string, now: number): Bucket | undefined {
    const b = buckets.get(key);
    if (!b) return undefined;
    if (now - b.windowStart >= opts.windowMs) {
      buckets.delete(key);
      return undefined;
    }
    return b;
  }

  return {
    consume(key, now = Date.now()) {
      const existing = currentBucket(key, now);
      if (!existing) {
        buckets.set(key, { count: 1, windowStart: now });
        return { allowed: true, remaining: opts.max - 1, retryAfterMs: 0 };
      }
      if (existing.count >= opts.max) {
        return { allowed: false, remaining: 0, retryAfterMs: opts.windowMs - (now - existing.windowStart) };
      }
      existing.count += 1;
      return { allowed: true, remaining: opts.max - existing.count, retryAfterMs: 0 };
    },
    peek(key, now = Date.now()) {
      const existing = currentBucket(key, now);
      if (!existing) return { allowed: true, remaining: opts.max, retryAfterMs: 0 };
      const allowed = existing.count < opts.max;
      return {
        allowed,
        remaining: Math.max(0, opts.max - existing.count),
        retryAfterMs: allowed ? 0 : opts.windowMs - (now - existing.windowStart),
      };
    },
    reset(key) {
      buckets.delete(key);
    },
    size() {
      return buckets.size;
    },
  };
}

/** 10 attempts / 15 minutes, per the auth brief. Keyed by callers as `email:<addr>` or `ip:<addr>`. */
export const loginRateLimiter: RateLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

/** True if the login attempt for this email+ip pair should be blocked. Consumes both buckets. */
export function isLoginRateLimited(email: string, ip: string | null): boolean {
  const emailResult = loginRateLimiter.consume(`email:${email.toLowerCase()}`);
  const ipResult = ip ? loginRateLimiter.consume(`ip:${ip}`) : { allowed: true, remaining: 0, retryAfterMs: 0 };
  return !emailResult.allowed || !ipResult.allowed;
}

/**
 * "Forgot password" requests: unlike login, this endpoint takes no password, so it has no
 * meaningful failure signal to key off of — an unauthenticated caller can hit it repeatedly to
 * mail-bomb an address (each request sends an email) or run up the HIBP outbound-request count.
 * 5 requests / hour per address, 20/hour per IP (shared IPs — offices, NAT — get a looser cap).
 */
export const passwordResetRateLimiter: RateLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const passwordResetIpRateLimiter: RateLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

/** True if this password-reset request should be blocked. Consumes both buckets. */
export function isPasswordResetRateLimited(email: string, ip: string | null): boolean {
  const emailResult = passwordResetRateLimiter.consume(`email:${email.toLowerCase()}`);
  const ipResult = ip ? passwordResetIpRateLimiter.consume(`ip:${ip}`) : { allowed: true, remaining: 0, retryAfterMs: 0 };
  return !emailResult.allowed || !ipResult.allowed;
}

/**
 * Admin TOTP verification: a 6-digit code is only ~1e6 combinations and (with the ±30s drift
 * window) up to 3 are valid at once, so this endpoint needs its own lockout independent of the
 * login rate limiter. 10 attempts / 15 minutes per already-authenticated admin user id.
 */
export const totpRateLimiter: RateLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

export function isTotpRateLimited(userId: string): boolean {
  return !totpRateLimiter.consume(`user:${userId}`).allowed;
}
