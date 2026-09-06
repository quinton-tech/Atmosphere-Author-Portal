import { describe, expect, it } from "vitest";
import { hashPassword, verifyPasswordHash, generateResetToken, hashResetToken, PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "./password-core";

describe("PASSWORD_RULES_TEXT", () => {
  it("states the actual minimum length enforced elsewhere", () => {
    expect(PASSWORD_RULES_TEXT).toContain(`${PASSWORD_MIN_LENGTH} characters`);
  });
});

describe("password hashing (Argon2id)", () => {
  it("hashes and verifies a matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    expect(await verifyPasswordHash(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a non-matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPasswordHash(hash, "wrong password")).toBe(false);
  });

  it("produces an Argon2id PHC string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verify never throws on garbage input, just returns false", async () => {
    await expect(verifyPasswordHash("not-a-real-hash", "anything")).resolves.toBe(false);
  });

  it("PASSWORD_MIN_LENGTH matches the brief (12+ chars)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });
});

describe("reset token hashing", () => {
  it("generates a 64-char hex token (32 random bytes)", () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates distinct tokens", () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });

  it("hashResetToken is deterministic SHA-256 hex", () => {
    const token = "a".repeat(64);
    const hash1 = hashResetToken(token);
    const hash2 = hashResetToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 of 64 "a" characters, verified independently with node:crypto.
    expect(hash1).toBe("ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
  });

  it("different tokens hash differently", () => {
    expect(hashResetToken(generateResetToken())).not.toBe(hashResetToken(generateResetToken()));
  });
});
