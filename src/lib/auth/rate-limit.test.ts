import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows attempts up to the max within a window", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
    const now = 0;
    expect(limiter.consume("a", now).allowed).toBe(true);
    expect(limiter.consume("a", now).allowed).toBe(true);
    expect(limiter.consume("a", now).allowed).toBe(true);
    expect(limiter.consume("a", now).allowed).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.consume("a", 0).allowed).toBe(true);
    expect(limiter.consume("b", 0).allowed).toBe(true);
    expect(limiter.consume("a", 0).allowed).toBe(false);
    expect(limiter.consume("b", 0).allowed).toBe(false);
  });

  it("resets once the window elapses", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.consume("a", 0).allowed).toBe(true);
    expect(limiter.consume("a", 500).allowed).toBe(false);
    expect(limiter.consume("a", 1000).allowed).toBe(true); // window has rolled over
  });

  it("reports retryAfterMs when blocked", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    limiter.consume("a", 0);
    const result = limiter.consume("a", 400);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(600);
  });

  it("peek does not consume an attempt", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.peek("a", 0).allowed).toBe(true);
    expect(limiter.peek("a", 0).allowed).toBe(true);
    limiter.consume("a", 0);
    expect(limiter.peek("a", 0).allowed).toBe(false);
  });

  it("reset clears a key immediately", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    limiter.consume("a", 0);
    expect(limiter.peek("a", 0).allowed).toBe(false);
    limiter.reset("a");
    expect(limiter.peek("a", 0).allowed).toBe(true);
  });
});
