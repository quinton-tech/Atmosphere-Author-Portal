import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contactInfoSchema, planContactInfoPatch } from "./writes";

describe("planContactInfoPatch", () => {
  const map = { phone: "phone", street: "address", city: "city", region: "state", postalCode: "zip" }; // country unmapped
  it("emits only changed, mapped, allow-listed fields", () => {
    const { patch, changed, unmapped } = planContactInfoPatch(
      { phone: "+1 512 555 0100", city: "Austin", country: "USA", street: "1 Main St" },
      { phone: "+1 512 555 0100", city: "Dallas", street: "1 Main St" },
      map,
    );
    expect(patch).toEqual({ city: "Austin" });
    expect(changed).toEqual(["city"]);
    expect(unmapped).toEqual(["country"]);
  });
  it("rejects junk phone numbers and does not accept email", () => {
    expect(contactInfoSchema.safeParse({ phone: "call me" }).success).toBe(false);
    expect(contactInfoSchema.strict().safeParse({ email: "x@y.z" }).success).toBe(false);
  });
});

/**
 * Guard: no file under src/ except src/lib/hubspot/writes.ts and the concrete client that implements
 * HubSpotContactWriter may call a HubSpot mutating method. Extend the allow-list deliberately.
 */
describe("hubspot write guard", () => {
  const ALLOWED = new Set(["src/lib/hubspot/writes.ts", "src/lib/hubspot/client.ts"]);
  const MUTATING = /\b(basicApi|batchApi|associationsApi)\.(create|update|archive|merge)\b|\.(crm\.objects|crm\.contacts)\.[a-zA-Z.]*\.(create|update|archive|merge)\(/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("only allow-listed files call HubSpot mutating methods", () => {
    const root = join(__dirname, "../../..");
    const offenders = walk(join(root, "src"))
      .filter((p) => MUTATING.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(root.length + 1))
      .filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });
});
