import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { env, isDemoMode } from "@/lib/env";
import { runFullSync, runIncrementalSync } from "@/lib/hubspot/sync";

// Full syncs (≈200 pages at 20k Projects) can outrun a single invocation; give this route the
// platform max and let it self-continue via `after()` below when a run isn't done yet.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Constant-time comparison so response timing can't be used to guess CRON_SECRET byte-by-byte. */
function isValidCronAuth(authHeader: string | null): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(authHeader ?? "");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidCronAuth(authHeader)) return unauthorized();

  // Demo mode has no HubSpot credentials; the fixture author is seeded directly (`--demo` seed),
  // so there's nothing to sync.
  if (isDemoMode()) return NextResponse.json({ skipped: "demo mode" }, { status: 200 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "full" ? "full" : "incremental";

  const result = kind === "full" ? await runFullSync() : await runIncrementalSync();

  if (!result.done) {
    // Resume the run in a follow-up invocation rather than block this response on it. `after()`
    // keeps the function alive briefly post-response (up to `maxDuration`); we only need it alive
    // long enough to hand the request off, not to wait out the whole continuation, so this races
    // the fetch against a short timeout instead of awaiting it to completion. If this particular
    // hand-off is dropped (cold start, deploy, etc.), the next scheduled cron tick still resumes
    // the run from the cursor persisted in app_settings — see sync.ts's runPagedSync.
    after(async () => {
      try {
        await Promise.race([
          fetch(request.url, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
          sleep(5000),
        ]);
      } catch {
        // Best-effort continuation only.
      }
    });
  }

  return NextResponse.json({ kind, ...result });
}
