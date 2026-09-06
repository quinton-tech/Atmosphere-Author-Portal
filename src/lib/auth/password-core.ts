/**
 * Pure password/token helpers: no `next/headers`, no `@/db`, no `@/lib/env`,
 * no `server-only`. Kept separate from `password.ts` (which has all of
 * those) so `password-core.test.ts` can unit test hashing/token logic
 * without needing DATABASE_URL etc. — same split as `src/lib/hubspot/stages.ts`
 * (pure) vs `sync.ts` (DB-touching).
 */
import { randomBytes, createHash } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 12;

/** User-facing copy for both the "set/change password" and "reset password" forms — keep in sync
 *  with the enforcement in `password.ts`'s `checkPasswordStrength` (length + HIBP breach check). */
export const PASSWORD_RULES_TEXT = `Use at least ${PASSWORD_MIN_LENGTH} characters. We check new passwords against known data breaches, so pick one that isn't already public.`;

// @node-rs/argon2's `Algorithm` is declared as an ambient `const enum`, which
// can't be referenced under `isolatedModules` (set in tsconfig.json). Argon2id
// is the package's own default (see its docs), so we simply don't pass one —
// this hashes as Argon2id either way.
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password);
}

export async function verifyPasswordHash(hashed: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hashed, password);
  } catch {
    // Malformed/foreign hash strings throw rather than returning false.
    return false;
  }
}

/** 32 bytes of randomness, hex-encoded. This is the value that goes in the email link. */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 of the token. Only the hash is ever stored, per `password_reset_tokens.token_hash`. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
