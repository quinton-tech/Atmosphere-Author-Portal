/**
 * Pure rate-limit decision logic: no `server-only`, no `@/db` — kept separate from
 * `rate-limit.ts` (which does the actual atomic Postgres upsert) so this file's `.test.ts` can
 * unit-test the fixed-window decision rule directly, without a database. Same split as
 * `password-core.ts` vs `password.ts`.
 *
 * `nextRateLimitState` mirrors, in plain JS, exactly what `rate-limit.ts`'s SQL `CASE` expressions
 * do inside the `INSERT ... ON CONFLICT DO UPDATE`: if the existing window has already elapsed,
 * the counter resets to 1 with a fresh window; otherwise it increments within the same window.
 * Doing the real check as one atomic upsert (rather than a read-then-write) is what makes it safe
 * under concurrent requests across any number of serverless instances — this function exists to
 * document and test that logic in isolation, not to enforce anything itself.
 */

export type RateLimitState = { count: number; windowEnds: Date };

export type RateLimitResult = {
  /** Whether this attempt is allowed. */
  allowed: boolean;
  /** Attempts remaining in the current window, after this check. */
  remaining: number;
  /** Milliseconds until the window resets, if blocked. */
  retryAfterMs: number;
};

/** `current` is the existing row for this key, if any (`undefined` the first time a key is seen). */
export function nextRateLimitState(current: RateLimitState | undefined, now: Date, windowMs: number): RateLimitState {
  if (!current || current.windowEnds.getTime() < now.getTime()) {
    return { count: 1, windowEnds: new Date(now.getTime() + windowMs) };
  }
  return { count: current.count + 1, windowEnds: current.windowEnds };
}

export function toRateLimitResult(state: RateLimitState, max: number, now: Date): RateLimitResult {
  const allowed = state.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - state.count),
    retryAfterMs: allowed ? 0 : Math.max(0, state.windowEnds.getTime() - now.getTime()),
  };
}
