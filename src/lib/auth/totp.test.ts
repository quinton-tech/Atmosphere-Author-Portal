import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpKeyUri, verifyTotpCode } from "./totp";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

async function codeFor(secret: string, epoch = Date.now() / 1000): Promise<string> {
  return new TOTP({ crypto: cryptoPlugin, base32: base32Plugin, secret }).generate({ epoch });
}

describe("generateTotpSecret", () => {
  it("returns a Base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("returns distinct secrets", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("totpKeyUri", () => {
  it("builds an otpauth:// URI carrying the issuer, account, and secret", () => {
    const uri = totpKeyUri("JBSWY3DPEHPK3PXP", "author@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("Atmosphere");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(decodeURIComponent(uri)).toContain("author@example.com");
  });
});

describe("verifyTotpCode", () => {
  it("accepts a code generated for the current time", async () => {
    const secret = generateTotpSecret();
    const code = await codeFor(secret);
    expect(await verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const secret = generateTotpSecret();
    const code = await codeFor(secret);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyTotpCode(secret, wrong)).toBe(false);
  });

  it("rejects a code for a different secret", async () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const code = await codeFor(secretA);
    expect(await verifyTotpCode(secretB, code)).toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpCode(secret, "abc")).toBe(false);
    expect(await verifyTotpCode(secret, "")).toBe(false);
    expect(await verifyTotpCode(secret, "12345")).toBe(false);
  });

  it("accepts a code from ~30s ago (clock drift tolerance)", async () => {
    const secret = generateTotpSecret();
    const code = await codeFor(secret, Date.now() / 1000 - 30);
    expect(await verifyTotpCode(secret, code)).toBe(true);
  });

  it("strips whitespace from the submitted code", async () => {
    const secret = generateTotpSecret();
    const code = await codeFor(secret);
    expect(await verifyTotpCode(secret, ` ${code} `)).toBe(true);
  });
});
