/**
 * CLI entry point: `npm run team:import`. Same `server-only` + `tsx` re-exec workaround as
 * src/lib/hubspot/run-sync.ts — see that file's header comment for why this is necessary and why
 * the real fix belongs in src/db/index.ts / src/lib/env.ts (out of scope here).
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

  const { importTeamFromWebsite } = await import("./import");

  console.log("[team:import] importing from atmospherepress.com…");
  const result = await importTeamFromWebsite(null);
  console.log("[team:import] done:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error("[team:import] failed:", err);
  process.exit(1);
});
