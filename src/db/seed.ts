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
  const { users, stageConfig, stageMilestones, appSettings } = await import("./schema");
  const { env, isDemoMode } = await import("@/lib/env");
  const { and, eq } = await import("drizzle-orm");

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
  // The 7 real HubSpot "Publishing Pipeline" stages (ids discovered 2026-09-06), spaced x10 so the
  // derived typical-path stages below (Cold Reading, Cover Design, …) slot between them. Inserted
  // only when missing; staff edits on /admin/stages are never overwritten.
  // ---------------------------------------------------------------------
  const defaultStages = [
    { key: "onboarding", label: "Onboarding", description: "We're setting up your project: contract, schedule, and introductions to your team.", hubspotValues: ["acc364b5-d367-49f4-a957-cc4fbf7e8e4b", "Onboarding"], sortOrder: 10, typicalWeeks: 2, isTerminal: false },
    { key: "editorial", label: "Developmental Editing", description: "Your developmental editor is working through your manuscript with you.", hubspotValues: ["c51bb66c-8141-44ef-82ec-703ae9c3a19f", "Editorial"], sortOrder: 20, typicalWeeks: 8, isTerminal: false },
    { key: "proofreading", label: "Proofreading", description: "Your manuscript is being proofread line by line.", hubspotValues: ["6480a063-31a5-4beb-bce8-12e2edb48f83", "Proofreading"], sortOrder: 30, typicalWeeks: 4, isTerminal: false },
    { key: "interior_design", label: "Interior Design", description: "Your interior designer is laying out the pages of your book.", hubspotValues: ["d742ec1d-2e4d-4e7f-81e7-d33314c0074e", "Interior Design"], sortOrder: 60, typicalWeeks: 4, isTerminal: false },
    { key: "off_to_printer", label: "Off to Printer", description: "Your files are with the printer and distribution is being set up.", hubspotValues: ["f70c1fd3-a302-4ee2-be4f-33dc703631e7", "Off to Printer"], sortOrder: 70, typicalWeeks: 6, isTerminal: false },
    { key: "publicity", label: "Publicity", description: "Your book is out and our publicity team is at work.", hubspotValues: ["1185861696", "Publicity"], sortOrder: 80, typicalWeeks: 12, isTerminal: false },
    { key: "completed", label: "Published", description: "Your project with Atmosphere is complete. Congratulations.", hubspotValues: ["1237352882", "Completed"], sortOrder: 90, typicalWeeks: null, isTerminal: true },
  ] as const;

  for (const s of defaultStages) {
    await db
      .insert(stageConfig)
      .values({
        key: s.key,
        label: s.label,
        description: s.description,
        hubspotValues: [...s.hubspotValues],
        sortOrder: s.sortOrder,
        typicalWeeks: s.typicalWeeks,
        isTerminal: s.isTerminal,
      })
      .onConflictDoNothing({ target: stageConfig.key });
  }
  console.log(`[seed] ensured ${defaultStages.length} default stage_config rows`);

  // ---------------------------------------------------------------------
  // Renumber the original pipeline stages onto a spaced-out (x10) sort order so there's room to
  // slot the new derived "typical path" stages (Cold Reading, Cover Design, …) in between, without
  // HubSpot ever changing. Additive/idempotent: a row is only renumbered when its sortOrder still
  // exactly matches the value it was *originally* seeded with — i.e. staff never touched it — so a
  // customized sort order is never clobbered by re-running this script. Rows that this feature
  // turns into "derived" stages (cold_reading, cover_design, interior_proofing) get their new
  // sortOrder set directly below instead, so they're deliberately not in this map.
  // ---------------------------------------------------------------------
  const PIPELINE_SORT_ORDER_MIGRATION: Record<string, { from: number; to: number }> = {
    onboarding: { from: 1, to: 10 },
    editorial: { from: 2, to: 20 },
    proofreading: { from: 3, to: 30 },
    interior_design: { from: 4, to: 60 },
    off_to_printer: { from: 5, to: 70 },
    publicity: { from: 6, to: 80 },
    completed: { from: 7, to: 90 },
  };
  let renumbered = 0;
  for (const [key, { from, to }] of Object.entries(PIPELINE_SORT_ORDER_MIGRATION)) {
    const [row] = await db
      .select({ sortOrder: stageConfig.sortOrder, kind: stageConfig.kind })
      .from(stageConfig)
      .where(eq(stageConfig.key, key))
      .limit(1);
    if (row && row.kind !== "derived" && row.sortOrder === from) {
      await db.update(stageConfig).set({ sortOrder: to, updatedAt: new Date() }).where(eq(stageConfig.key, key));
      renumbered++;
    }
  }
  console.log(`[seed] renumbered ${renumbered}/${Object.keys(PIPELINE_SORT_ORDER_MIGRATION).length} default pipeline stage sort orders`);

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
  // Default sub-stage milestones. Idempotent: only seeded the first time (when stage_milestones
  // is empty) so staff edits/deletes made afterward are never re-created by re-running this
  // script. `stageKey` here uses the real HubSpot stage_config keys (editorial, publicity) per
  // the current production pipeline — a row is skipped (with a warning) rather than failing the
  // whole script if that key doesn't exist locally yet, the same guard seed-demo.ts's
  // `mergeStageHubspotValues` uses for the analogous case.
  // ---------------------------------------------------------------------
  type NewMilestone = typeof stageMilestones.$inferInsert;

  const [existingMilestone] = await db.select({ id: stageMilestones.id }).from(stageMilestones).limit(1);
  if (!existingMilestone) {
    const knownStageKeys = new Set((await db.select({ key: stageConfig.key }).from(stageConfig)).map((s) => s.key));

    const premierDoneValues = [
      "Kirkus rev sent to author",
      "BookLife rev sent to author",
      "Kirkus link sent to author",
      "BookLife link sent to author",
      "IndieReader sent to author",
    ];

    function reviewMilestone(n: number): NewMilestone {
      return {
        stageKey: "publicity",
        label: `Review ${n}`,
        propertyName: `review_${n}`,
        kind: "status",
        doneValues: ["Sent to Author"],
        hiddenValues: ["IBR NOT publishing"],
        venueProperty: `review_${n}_venue`,
        linkProperty: `review_${n}_link`,
        includeRule: null,
        sortOrder: 3 + n,
      };
    }

    const defaultMilestones: NewMilestone[] = [
      {
        stageKey: "editorial",
        label: "Cold read",
        propertyName: "cold_read_status",
        kind: "status",
        doneValues: ["Completed", "Completed - Pre-ID"],
        includeRule: { packages: ["Flagship"], addOns: ["Cold Reading"] },
        sortOrder: 0,
      },
      {
        stageKey: "publicity",
        label: "Premier review",
        propertyName: "premier_review",
        kind: "status",
        doneValues: premierDoneValues,
        hiddenValues: ["NOT publishing"],
        venueProperty: "premier_review_venue",
        linkProperty: "kirkus_link",
        includeRule: null,
        sortOrder: 0,
      },
      {
        stageKey: "publicity",
        label: "Second premier review",
        propertyName: "n2nd_premier_review",
        kind: "status",
        doneValues: premierDoneValues,
        hiddenValues: ["NOT publishing"],
        venueProperty: "n2nd_premier_review_venue",
        includeRule: null,
        sortOrder: 1,
      },
      {
        stageKey: "publicity",
        label: "NetGalley",
        propertyName: "netgalley",
        kind: "status",
        doneValues: ["Archived", "Author Received"],
        dateProperty: "netgalley_start_date",
        linkProperty: "netgalley_link",
        includeRule: null,
        sortOrder: 2,
      },
      {
        stageKey: "publicity",
        label: "Goodreads listing",
        propertyName: "goodreads_listing",
        kind: "status",
        doneValues: ["Completed", "Author Received"],
        linkProperty: "goodreads_link",
        includeRule: null,
        sortOrder: 3,
      },
      reviewMilestone(1),
      reviewMilestone(2),
      reviewMilestone(3),
      reviewMilestone(4),
      {
        stageKey: "publicity",
        label: "Boost",
        propertyName: "boost_status",
        kind: "status",
        doneValues: ["Active", "Archived"],
        hiddenValues: ["Declined"],
        dateProperty: "boost_initiation_date",
        includeRule: { addOns: ["Boost"] },
        sortOrder: 8,
      },
      {
        stageKey: "publicity",
        label: "Publicity complete",
        propertyName: "publicity_complete",
        kind: "date",
        includeRule: null,
        sortOrder: 9,
      },
      // The three below drive the new "derived" typical-path stages (see the sort-order migration
      // above and the wiring step below): Cover Design, Final Files, Physical Proof Copy.
      {
        stageKey: "interior_design",
        label: "Cover design",
        propertyName: "cd_assigned",
        kind: "date",
        includeRule: null,
        sortOrder: 0,
      },
      {
        stageKey: "off_to_printer",
        label: "Distribution files uploaded",
        propertyName: "ingram_distribution_status",
        kind: "status",
        doneValues: ["Uploaded - distribution ON"],
        inProgressValues: ["Ready for upload", "Ingram template needed (KDP is draft)", "Ingram template needed (KDP is live)"],
        includeRule: null,
        sortOrder: 0,
      },
      {
        stageKey: "off_to_printer",
        label: "Proof copy",
        propertyName: "proof_copy",
        kind: "status",
        doneValues: ["ordered"],
        inProgressValues: ["requested"],
        includeRule: null,
        sortOrder: 1,
      },
    ];

    const seedable = defaultMilestones.filter((m) => {
      if (knownStageKeys.has(m.stageKey)) return true;
      console.warn(`[seed] skipping default milestone "${m.label}" — stage_config key "${m.stageKey}" not found`);
      return false;
    });
    if (seedable.length > 0) await db.insert(stageMilestones).values(seedable);
    console.log(`[seed] ensured ${seedable.length}/${defaultMilestones.length} default stage_milestones rows`);
  } else {
    console.log("[seed] stage_milestones already has rows — skipping default milestone seed");
  }

  // ---------------------------------------------------------------------
  // Derived "typical path" stages, computed from milestones rather than HubSpot's own Pipeline
  // Stage dropdown (see src/lib/hubspot/derived-stages.ts). Additive + idempotent:
  //  - a brand-new key (final_files, physical_proof) is simply inserted;
  //  - a key that already exists as an untouched default "pipeline" placeholder (cold_reading,
  //    cover_design, interior_proofing — never mapped to a real HubSpot value, hubspotValues: [])
  //    is converted to "derived" in place;
  //  - a key that exists but was customized (kind already "derived", or hubspotValues non-empty
  //    meaning staff mapped it to a real HubSpot value) is left alone and only logged, since
  //    stage_config.key is a primary key and can't be safely overwritten.
  // Milestone links are resolved by (propertyName, stageKey) so this works whether the milestones
  // above were seeded just now or already existed from an earlier run.
  // ---------------------------------------------------------------------
  async function findMilestoneId(propertyName: string, stageKey: string): Promise<string | null> {
    const [row] = await db
      .select({ id: stageMilestones.id })
      .from(stageMilestones)
      .where(and(eq(stageMilestones.propertyName, propertyName), eq(stageMilestones.stageKey, stageKey)))
      .limit(1);
    return row?.id ?? null;
  }

  type DerivedStageDef = {
    key: string;
    label: string;
    description: string;
    parentStageKey: string;
    sortOrder: number;
    showWhenEmpty: boolean;
    milestoneLookup: { propertyName: string; stageKey: string }[];
  };

  const derivedStageDefs: DerivedStageDef[] = [
    {
      key: "cold_reading",
      label: "Cold Reading",
      description: "A fresh reader is reviewing your manuscript with no prior context, catching anything earlier passes missed.",
      parentStageKey: "proofreading",
      sortOrder: 35,
      showWhenEmpty: false, // not every author gets a cold read (Flagship / Cold Reading add-on only)
      milestoneLookup: [{ propertyName: "cold_read_status", stageKey: "editorial" }],
    },
    {
      key: "cover_design",
      label: "Cover Design",
      description: "Your cover designer is creating concepts for your book's cover.",
      parentStageKey: "interior_design",
      sortOrder: 55,
      showWhenEmpty: true,
      milestoneLookup: [{ propertyName: "cd_assigned", stageKey: "interior_design" }],
    },
    {
      key: "interior_proofing",
      label: "Interior Design Proofing",
      description: "A final check of the interior layout — we send a proof PDF for your review before it goes to print.",
      parentStageKey: "interior_design",
      sortOrder: 65,
      showWhenEmpty: true, // no milestone wired up yet; stays "upcoming" until staff attach one on /admin/stages
      milestoneLookup: [],
    },
    {
      key: "final_files",
      label: "Final Files",
      description: "Your finished files are prepared and uploaded for distribution and printing.",
      parentStageKey: "off_to_printer",
      sortOrder: 72,
      showWhenEmpty: true,
      milestoneLookup: [{ propertyName: "ingram_distribution_status", stageKey: "off_to_printer" }],
    },
    {
      key: "physical_proof",
      label: "Physical Proof Copy",
      description: "A physical proof copy is ordered so you can review your finished book in print before it's finalized.",
      parentStageKey: "off_to_printer",
      sortOrder: 74,
      showWhenEmpty: true,
      milestoneLookup: [{ propertyName: "proof_copy", stageKey: "off_to_printer" }],
    },
  ];

  let derivedCreated = 0;
  let derivedConverted = 0;
  let derivedSkipped = 0;
  for (const def of derivedStageDefs) {
    const milestoneIds = (await Promise.all(def.milestoneLookup.map((m) => findMilestoneId(m.propertyName, m.stageKey)))).filter(
      (id): id is string => !!id,
    );

    const [existingRow] = await db.select().from(stageConfig).where(eq(stageConfig.key, def.key)).limit(1);
    if (!existingRow) {
      await db.insert(stageConfig).values({
        key: def.key,
        label: def.label,
        description: def.description,
        hubspotValues: [],
        sortOrder: def.sortOrder,
        typicalWeeks: null,
        isTerminal: false,
        kind: "derived",
        derivedMilestoneIds: milestoneIds,
        parentStageKey: def.parentStageKey,
        showWhenEmpty: def.showWhenEmpty,
      });
      derivedCreated++;
    } else if (existingRow.kind !== "derived" && existingRow.hubspotValues.length === 0) {
      await db
        .update(stageConfig)
        .set({
          kind: "derived",
          derivedMilestoneIds: milestoneIds,
          parentStageKey: def.parentStageKey,
          showWhenEmpty: def.showWhenEmpty,
          sortOrder: def.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(stageConfig.key, def.key));
      derivedConverted++;
    } else {
      console.warn(`[seed] skipping derived stage "${def.key}" — an existing customized stage_config row already uses this key`);
      derivedSkipped++;
    }
  }
  console.log(`[seed] derived stages: ${derivedCreated} created, ${derivedConverted} converted from defaults, ${derivedSkipped} skipped`);

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
