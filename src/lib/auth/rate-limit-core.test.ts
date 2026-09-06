import { describe, expect, it } from "vitest";
import { nextRateLimitState, toRateLimitResult } from "./rate-limit-core";

describe("nextRateLimitState", () => {
  const windowMs = 1000;

  it("starts a fresh window at count 1 when there's no existing state", () => {
    const now = new Date(0);
    const state = nextRateLimitState(undefined, now, windowMs);
    expect(state).toEqual({ count: 1, windowEnds: new Date(windowMs) });
  });

  it("increments the count within the same window", () => {
    const windowEnds = new Date(1000);
    const state = nextRateLimitState({ count: 1, windowEnds }, new Date(500), windowMs);
    expect(state).toEqual({ count: 2, windowEnds });
  });

  it("keeps incrementing right up to the edge of the window", () => {
    const windowEnds = new Date(1000);
    const state = nextRateLimitState({ count: 9, windowEnds }, new Date(999), windowMs);
    expect(state).toEqual({ count: 10, windowEnds });
  });

  it("keeps incrementing exactly at the window boundary (matches SQL's strict `<`)", () => {
    const windowEnds = new Date(1000);
    const state = nextRateLimitState({ count: 10, windowEnds }, new Date(1000), windowMs);
    expect(state).toEqual({ count: 11, windowEnds });
  });

  it("resets to count 1 with a fresh window once the old window has elapsed", () => {
    const state = nextRateLimitState({ count: 10, windowEnds: new Date(1000) }, new Date(1001), windowMs);
    expect(state).toEqual({ count: 1, windowEnds: new Date(2001) });
  });

  it("resets even when the old window elapsed long ago", () => {
    const state = nextRateLimitState({ count: 10, windowEnds: new Date(1000) }, new Date(50_000), windowMs);
    expect(state).toEqual({ count: 1, windowEnds: new Date(51_000) });
  });
});

describe("toRateLimitResult", () => {
  it("allows and reports remaining attempts under the max", () => {
    const result = toRateLimitResult({ count: 3, windowEnds: new Date(1000) }, 10, new Date(0));
    expect(result).toEqual({ allowed: true, remaining: 7, retryAfterMs: 0 });
  });

  it("allows exactly at the max (count == max)", () => {
    const result = toRateLimitResult({ count: 10, windowEnds: new Date(1000) }, 10, new Date(0));
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("blocks once count exceeds the max, with retryAfterMs until the window ends", () => {
    const result = toRateLimitResult({ count: 11, windowEnds: new Date(1000) }, 10, new Date(400));
    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 600 });
  });

  it("never reports a negative retryAfterMs even if now is past windowEnds", () => {
    const result = toRateLimitResult({ count: 11, windowEnds: new Date(1000) }, 10, new Date(5000));
    expect(result.retryAfterMs).toBe(0);
  });
});
