/**
 * Default `property_display` friendly labels for raw HubSpot dropdown values that would otherwise
 * reach authors as internal shorthand ("2 done", "RF", "IBR", "Author Received", …). Split out of
 * `seed.ts` per CLAUDE.md's "keep files under ~300 lines" convention.
 *
 * `propertyId` is either:
 *  - a portal id from `src/lib/hubspot/properties.ts` (e.g. "developmentalEditorStatus",
 *    "proofreaderStatus", "package") for properties surfaced directly on the book, or
 *  - the raw HubSpot internal property name (e.g. "review_1_venue", "netgalley") for properties
 *    driven by a `stage_milestones` row, since milestones read straight off the HubSpot object
 *    and are never remapped through `properties.ts`.
 *
 * Seeded with onConflictDoNothing on (propertyId, rawValue) — see `seedPropertyDisplayLabels`
 * below — so a label staff already edited on /admin/properties is never overwritten by re-running
 * the seed.
 */
export type PropertyDisplaySeed = { propertyId: string; rawValue: string; label: string };

const REVIEW_VENUE_LABELS: Record<string, string> = {
  RF: "Readers' Favorite",
  IBR: "Independent Book Review",
  MBR: "Midwest Book Review",
  LT: "Literary Titan",
  BV: "BookViral",
  FQ: "Feathered Quill",
  "US Rev": "US Review of Books",
  "Book Commentary": "Book Commentary",
  "Chanticleer Reviews": "Chanticleer Reviews",
  "Lone Star Literary Life": "Lone Star Literary Life",
};

const PREMIER_VENUE_LABELS: Record<string, string> = {
  Kirkus: "Kirkus Reviews",
  Booklife: "BookLife",
  IndieReader: "IndieReader",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  Needed: "Being arranged",
  Paid: "Requested",
  "Sent to Author": "Review delivered to you",
  "IBR asked to publish": "Under consideration",
  "IBR NOT publishing": "Not published",
  "MBR DRAFT sent to author": "Draft sent to you",
};

const PREMIER_STATUS_LABELS: Record<string, string> = {
  Needed: "Being arranged",
  Paid: "Requested",
  "Kirkus rev sent to author": "Review delivered to you",
  "BookLife rev sent to author": "Review delivered to you",
  "Kirkus link sent to author": "Review published",
  "BookLife link sent to author": "Review published",
  "IndieReader sent to author": "Review delivered to you",
  "NOT publishing": "Not published",
};

function expand(propertyIds: string[], values: Record<string, string>): PropertyDisplaySeed[] {
  return propertyIds.flatMap((propertyId) =>
    Object.entries(values).map(([rawValue, label]) => ({ propertyId, rawValue, label })),
  );
}

export const DEFAULT_PROPERTY_DISPLAY: PropertyDisplaySeed[] = [
  ...expand(["developmentalEditorStatus"], {
    confirmed: "Editor confirmed",
    done: "First pass complete",
    "2 done": "Second pass complete",
    "3+ done": "Third pass complete",
  }),
  ...expand(["proofreaderStatus"], {
    "sent for AI review": "First read in progress",
    "AI review complete": "First read complete",
    "1st review complete": "First review complete",
    "2nd review complete": "Second review complete",
    "sent to author": "Sent to you for review",
  }),
  ...expand(["review_1_venue", "review_2_venue", "review_3_venue", "review_4_venue"], REVIEW_VENUE_LABELS),
  ...expand(["premier_review_venue", "n2nd_premier_review_venue"], PREMIER_VENUE_LABELS),
  ...expand(["review_1", "review_2", "review_3", "review_4"], REVIEW_STATUS_LABELS),
  ...expand(["premier_review", "n2nd_premier_review"], PREMIER_STATUS_LABELS),
  ...expand(["netgalley"], {
    Needed: "Being set up",
    Active: "Live for reviewers",
    Archived: "Campaign finished",
    "Author Received": "Results sent to you",
  }),
  ...expand(["goodreads_listing"], {
    Needed: "Being set up",
    Completed: "Listing live",
    "Author Received": "Listing live",
  }),
  ...expand(["boost_status"], {
    Interested: "In discussion",
    "Sent Meeting Link": "Meeting scheduled",
    Scheduled: "Meeting scheduled",
    "Sent Contract": "Contract sent",
    Signed: "Signed",
    Active: "Running",
    Archived: "Finished",
  }),
  ...expand(["cold_read_status"], {
    Needed: "Scheduled",
    "Needed - Pre-ID": "Scheduled",
    Completed: "Complete",
    "Completed - Pre-ID": "Complete",
  }),
  ...expand(["proof_copy"], {
    requested: "Requested",
    ordered: "Ordered",
  }),
  ...expand(["ingram_distribution_status"], {
    "Uploaded - distribution ON": "Live with distributors",
    "Ready for upload": "Ready to upload",
    "Ingram template needed (KDP is draft)": "Being prepared",
    "Ingram template needed (KDP is live)": "Being prepared",
  }),
  ...expand(["package"], {
    Essential: "Essential package",
    Premium: "Premium package",
    Flagship: "Flagship package",
    Classic: "Classic package",
    "Enterprise Publication": "Enterprise package",
  }),
];

/**
 * Inserts every row in `DEFAULT_PROPERTY_DISPLAY` that doesn't already exist for its
 * (propertyId, rawValue) pair. Never overwrites — a row staff already created or edited on
 * /admin/properties (same propertyId + rawValue) is left untouched.
 */
export async function seedPropertyDisplayLabels(): Promise<void> {
  const { db } = await import("./index");
  const { propertyDisplay } = await import("./schema");

  const inserted = await db
    .insert(propertyDisplay)
    .values(DEFAULT_PROPERTY_DISPLAY)
    .onConflictDoNothing({ target: [propertyDisplay.propertyId, propertyDisplay.rawValue] })
    .returning({ id: propertyDisplay.id });

  console.log(
    `[seed] ensured property_display defaults: ${inserted.length}/${DEFAULT_PROPERTY_DISPLAY.length} inserted (rest already existed — staff edits untouched)`,
  );
}
