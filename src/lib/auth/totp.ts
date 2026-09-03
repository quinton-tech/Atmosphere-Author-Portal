// Deliberately no `import "server-only"` here: these are pure functions (secrets
// are passed in, never read from the environment) and src/lib/auth/totp.test.ts
// unit-tests them directly, the same way src/lib/hubspot/stages.ts stays server-only-free
// so it can be unit tested without pulling in @/lib/env or @/db.
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import QRCode from "qrcode";

// otplib v13 requires explicit crypto/base32 plugins (no more implicit Node globals).
// Noble is pure-JS and works the same in Node; scure/base handles Base32 for otpauth URIs.
const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

const ISSUER = "Atmosphere Author Portal";

/** A fresh Base32-encoded TOTP secret. Not persisted until a code is verified against it. */
export function generateTotpSecret(): string {
  return new TOTP({ crypto: cryptoPlugin, base32: base32Plugin }).generateSecret();
}

/** `otpauth://` URI for the authenticator app QR code / manual entry. */
export function totpKeyUri(secret: string, accountEmail: string): string {
  const totp = new TOTP({ crypto: cryptoPlugin, base32: base32Plugin, issuer: ISSUER, label: accountEmail, secret });
  return totp.toURI();
}

/** Data URL (PNG) for the enrollment QR code. */
export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 240 });
}

/**
 * Verify a 6-digit TOTP code, allowing ±30s of clock drift either direction.
 * Rejects anything that isn't exactly 6 digits before touching the crypto.
 */
export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const totp = new TOTP({ crypto: cryptoPlugin, base32: base32Plugin, secret });
  const result = await totp.verify(cleaned, { epochTolerance: [30, 30] });
  return result.valid;
}
