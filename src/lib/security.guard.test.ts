import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural security guards, enforced at build/test time rather than by convention alone.
 * These are cheap, path-based checks (no DB, no network) — they catch a whole class of "forgot
 * the check" bugs (missing `requireAdmin()`, a page that never touches `@/lib/session`, a client
 * component that pulls in a server-only module) without needing a live app or database.
 *
 * What these guards do NOT prove — needs a real DB / integration test instead:
 * - That the ownership check inside `@/lib/session` / `@/lib/data/*` actually filters by the
 *   right user id at runtime (these tests only confirm the file *imports* the right module).
 * - That `requireAdmin()` is called before any mutation runs, not just present somewhere in the
 *   file (a `requireAdmin()` call that's unreachable, or in the wrong action, still passes).
 * - The HubSpot write guard (`src/lib/hubspot/writes.test.ts`, "hubspot write guard" describe
 *   block) — not duplicated here, see that file for the mutating-call allow-list check.
 */

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

function listFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

function rel(p: string): string {
  return p.slice(ROOT.length + 1);
}

describe("admin server actions always call requireAdmin()", () => {
  const actionFiles = listFiles(join(SRC, "app", "admin")).filter(
    (p) => p.endsWith("actions.ts") && !p.endsWith(".test.ts"),
  );

  it("found at least one admin actions.ts file (guard against a silently-empty glob)", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it.each(actionFiles.map((p) => [rel(p), p] as const))("%s contains requireAdmin(", (_label, p) => {
    const text = readFileSync(p, "utf8");
    expect(text).toMatch(/requireAdmin\(/);
  });
});

describe("author-facing pages and routes check the signed-in session", () => {
  /**
   * Files under these roots handle one author's data and must either import `requireUser`/
   * `currentUser` from "@/lib/session" (the only place `effectiveUserId`/ownership-scoping is
   * derived from) or carry an explicit allow-list comment explaining why not — e.g. a layout
   * that has no data of its own, or a shared, non-route helper that happens to live alongside
   * page.tsx/route.ts files.
   *
   * `// security-guard-allow: <reason>` anywhere in the file opts it out.
   */
  const roots = [
    join(SRC, "app", "(author)"),
    join(SRC, "app", "api", "files"),
    join(SRC, "app", "api", "chat"),
  ];

  const targetFiles = roots
    .flatMap((r) => listFiles(r))
    .filter((p) => /\/(page|route)\.tsx?$/.test(p));

  it("found page.tsx/route.ts files under (author)/, api/files/, and api/chat/ (guard against a silently-empty glob)", () => {
    expect(targetFiles.length).toBeGreaterThan(0);
  });

  it.each(targetFiles.map((p) => [rel(p), p] as const))(
    "%s imports @/lib/session or is allow-listed",
    (_label, p) => {
      const text = readFileSync(p, "utf8");
      const importsSession = /from ["']@\/lib\/session["']/.test(text);
      const allowListed = /security-guard-allow:/.test(text);
      expect(importsSession || allowListed, `${rel(p)} touches an author-facing route but never imports @/lib/session, and has no security-guard-allow comment explaining why`).toBe(true);
    },
  );
});

describe("client components never import server-only modules", () => {
  const allFiles = listFiles(SRC).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"));
  const clientFiles = allFiles.filter((p) => {
    const text = readFileSync(p, "utf8");
    // "use client" must be the first statement (ignoring leading whitespace/comments-free source,
    // which is how every file in this repo writes it) to actually take effect as a directive.
    return /^\s*["']use client["'];?/.test(text);
  });

  const FORBIDDEN_IMPORTS = ['"@/lib/env"', '"@/db"', '"@/auth"'];

  it("found at least one \"use client\" file (guard against a silently-empty glob)", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it.each(clientFiles.map((p) => [rel(p), p] as const))("%s does not import a server-only module", (_label, p) => {
    const text = readFileSync(p, "utf8");
    for (const spec of FORBIDDEN_IMPORTS) {
      expect(text.includes(`from ${spec}`), `${rel(p)} is "use client" but imports ${spec}`).toBe(false);
    }
  });
});

describe("HubSpot write surface (reference only)", () => {
  it("the allow-list guard lives in src/lib/hubspot/writes.test.ts ('hubspot write guard') — not duplicated here", () => {
    const p = join(SRC, "lib", "hubspot", "writes.test.ts");
    expect(statSync(p).isFile()).toBe(true);
    expect(readFileSync(p, "utf8")).toMatch(/hubspot write guard/);
  });
});
