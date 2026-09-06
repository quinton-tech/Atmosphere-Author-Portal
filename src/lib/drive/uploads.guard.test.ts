import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: no file under src/ except src/lib/drive/uploads.ts may call a Drive mutating method.
 * Mirrors the HubSpot write guard in src/lib/hubspot/writes.test.ts ("hubspot write guard").
 * Drive reads (src/lib/drive/client.ts, fixture.ts, admin.ts) must stay read-only forever;
 * the ONE approved exception is the author-uploads flow, isolated to this one module with its
 * own drive.file-scoped credential. Extend the allow-list deliberately.
 */
describe("drive write guard", () => {
  const ALLOWED = new Set(["src/lib/drive/uploads.ts"]);
  const MUTATING = /\bfiles\.(create|update|delete|copy)\(|\bpermissions\.create\(/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("only src/lib/drive/uploads.ts calls Drive mutating methods", () => {
    const root = join(__dirname, "../../..");
    const offenders = walk(join(root, "src"))
      .filter((p) => MUTATING.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(root.length + 1))
      .filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });
});
