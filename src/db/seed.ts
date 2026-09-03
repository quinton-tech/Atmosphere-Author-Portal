/**
 * Idempotent DB seed. Run with `npm run db:seed`.
 *
 * `src/lib/env.ts` and `src/db/index.ts` both `import "server-only"`, a marker package that throws
 * unconditionally unless the active module resolver honours the package.json "react-server" export
 * condition — Next's build sets that condition, plain `tsx` does not. Since this script has to run
 * outside Next, it re-execs itself once with `--conditions=react-server` active and only then
 * imports the real seeding logic. That import has to be dynamic — static `import` statements are
 * hoisted above everything else in the module, including this guard, so a static import would
 * already have thrown before the guard's re-exec ever ran. See `src/lib/hubspot/run-sync.ts` for
 * the same pattern and a fuller explanation; this is a per-script workaround, not a fix to the
 * underlying conflict (that fix belongs in the frozen `env.ts` / `db/index.ts`, out of scope here).
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
    process.exit(result.status ?? 0);
  }

  const { db } = await import("./index");
  const { users, stageConfig, appSettings } = await import("./schema");
  const { env, isDemoMode } = await import("@/lib/env");
  const { eq } = await import("drizzle-orm");

  // ---------------------------------------------------------------------
  // Admin bootstrap
  // ---------------------------------------------------------------------
  if (env.ADMIN_BOOTSTRAP_EMAIL) {
    const email = env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!existing) {
      await db.insert(users).values({ email, role: "admin", name: "Admin" });
      console.log(`[seed] created admin user ${email}`);
    } else if (existing.role !== "admin") {
      await db.update(users).set({ role: "admin" }).where(eq(users.id, existing.id));
      console.log(`[seed] promoted existing user ${email} to admin`);
    } else {
      console.log(`[seed] admin user ${email} already exists`);
    }
  } else {
    console.log("[seed] ADMIN_BOOTSTRAP_EMAIL not set — skipping admin bootstrap");
  }

  // ---------------------------------------------------------------------
  // Default pipeline stages. Onboarding → Developmental Editing → Proofreading → Cold Reading
  // (sometimes) → Cover Design → Interior Design → Interior Design Proofing → Publicity →
  // Published, per CLAUDE.md. `hubspotValues` starts empty — an admin maps raw HubSpot dropdown
  // values to these on /admin/stages once real data is flowing.
  // ---------------------------------------------------------------------
  const defaultStages = [
    {
      key: "onboarding",
      label: "Onboarding",
      description: "We're getting your project set up and your team assigned.",
      sortOrder: 0,
      typicalWeeks: 2,
      isTerminal: false,
    },
    {
      key: "developmental_editing",
      label: "Developmental Editing",
      description: "Your developmental editor is working through your manuscript.",
      sortOrder: 1,
      typicalWeeks: 8,
      isTerminal: false,
    },
    {
      key: "proofreading",
      label: "Proofreading",
      description: "Your proofreader is doing a close pass for grammar, spelling, and consistency.",
      sortOrder: 2,
      typicalWeeks: 4,
      isTerminal: false,
    },
    {
      key: "cold_reading",
      label: "Cold Reading",
      description: "A fresh reader is reviewing your manuscript with no prior context, catching anything earlier passes missed.",
      sortOrder: 3,
      typicalWeeks: 3,
      isTerminal: false,
    },
    {
      key: "cover_design",
      label: "Cover Design",
      description: "Your cover designer is creating concepts for your book's cover.",
      sortOrder: 4,
      typicalWeeks: 4,
      isTerminal: false,
    },
    {
      key: "interior_design",
      label: "Interior Design",
      description: "Your interior designer is laying out the pages of your book.",
      sortOrder: 5,
      typicalWeeks: 4,
      isTerminal: false,
    },
    {
      key: "interior_proofing",
      label: "Interior Design Proofing",
      description: "A final check of the interior layout before it goes to print.",
      sortOrder: 6,
      typicalWeeks: 2,
      isTerminal: false,
    },
    {
      key: "publicity",
      label: "Publicity",
      description: "Our publicity team is preparing your book's launch.",
      sortOrder: 7,
      typicalWeeks: 6,
      isTerminal: false,
    },
    {
      key: "published",
      label: "Published",
      description: "Your book is published.",
      sortOrder: 8,
      typicalWeeks: null,
      isTerminal: true,
    },
  ] as const;

  for (const s of defaultStages) {
    await db
      .insert(stageConfig)
      .values({
        key: s.key,
        label: s.label,
        description: s.description,
        hubspotValues: [],
        sortOrder: s.sortOrder,
        typicalWeeks: s.typicalWeeks,
        isTerminal: s.isTerminal,
      })
      .onConflictDoNothing({ target: stageConfig.key });
  }
  console.log(`[seed] ensured ${defaultStages.length} default stage_config rows`);

  // ---------------------------------------------------------------------
  // app_settings defaults. onConflictDoNothing so staff edits made after the first seed are never
  // clobbered by re-running this script.
  // ---------------------------------------------------------------------
  const defaultSettings: Array<{ key: string; value: unknown }> = [
    { key: "assistant", value: { provider: null, model: null } },
    { key: "titleProperty", value: "name" },
    { key: "contactInfoTarget", value: "contact" },
    { key: "propertyMap", value: {} },
  ];
  for (const s of defaultSettings) {
    await db.insert(appSettings).values({ key: s.key, value: s.value }).onConflictDoNothing({ target: appSettings.key });
  }
  console.log(`[seed] ensured ${defaultSettings.length} default app_settings rows`);

  // ---------------------------------------------------------------------
  // Demo fixture data — `npm run db:seed -- --demo`, or whenever DEMO_MODE is set (so a Vercel
  // build/deploy step running this with DEMO_MODE=1 doesn't need the extra flag). See
  // src/db/seed-demo.ts and docs/DEMO.md.
  // ---------------------------------------------------------------------
  if (process.argv.includes("--demo") || isDemoMode()) {
    const { seedDemo } = await import("./seed-demo");
    await seedDemo();
  } else {
    console.log("[seed] --demo not passed and DEMO_MODE not set — skipping demo fixture data");
  }

  console.log("[seed] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
