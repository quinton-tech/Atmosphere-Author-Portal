/**
 * CLI entry point: `npm run sync:hubspot -- --kind=full` (or `--kind=incremental`, the default).
 *
 * `src/lib/env.ts` and `src/db/index.ts` both `import "server-only"`, a marker package that throws
 * unconditionally unless the active module resolver honours the package.json "react-server" export
 * condition — Next's build sets that condition, plain `tsx` does not. Since this script has to run
 * outside Next, it re-execs itself once with `--conditions=react-server` active (verified: running
 * a trivial `import "server-only"` script under `NODE_OPTIONS="--conditions=react-server" tsx …`
 * resolves to the package's no-op stub instead of throwing) and only then imports the real sync
 * code. That import has to be dynamic — static `import` statements are hoisted above everything
 * else in the module, including this guard, so a static import would already have thrown before
 * the guard's re-exec ever ran.
 *
 * This is a workaround local to this CLI entry point, not a fix to the shared `server-only` +
 * `tsx` conflict — see the final report for why `src/db/seed.ts` needs the same guard, and why the
 * real fix belongs in `src/db/index.ts` / `src/lib/env.ts` (out of scope here — frozen files).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

async function main(): Promise<void> {
  if (!process.env.__AP_RSC_REEXEC) {
    const tsxBin = resolve(process.cwd(), "node_modules/.bin/tsx");
    const nodeOptions = [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" ");
    const result = spawnSync(tsxBin, [__filename, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, NODE_OPTIONS: nodeOptions, __AP_RSC_REEXEC: "1" },
    });
    process.exit(result.status ?? 1);
  }

  const { runIncrementalSync, runFullSync } = await import("./sync");

  const kindArg = process.argv.find((a) => a.startsWith("--kind="));
  const kind = kindArg ? kindArg.slice("--kind=".length) : "incremental";
  if (kind !== "incremental" && kind !== "full") {
    console.error(`[sync:hubspot] unknown --kind=${kind}. Use --kind=incremental or --kind=full.`);
    process.exit(1);
  }

  console.log(`[sync:hubspot] running ${kind} sync…`);
  const result = kind === "full" ? await runFullSync() : await runIncrementalSync();
  console.log(
    `[sync:hubspot] ${kind} sync ${result.done ? "finished" : "paused — run again (or wait for the next cron tick) to resume"}`,
    result,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[sync:hubspot] failed:", err);
  process.exit(1);
});
