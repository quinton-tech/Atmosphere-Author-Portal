/**
 * Static fixture data for demo mode (`npm run db:seed -- --demo`, or `DEMO_MODE` set). Pure data
 * + small pure date helpers only — no db import — so `seed-demo.ts` stays focused on the actual
 * writes. See docs/DEMO.md for what this produces and the two demo logins.
 */
import { DEMO_FOLDER_ID } from "@/lib/drive/fixture";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const DEMO_ADMIN_EMAIL = "admin@demo.atmospherepress.test";
export const DEMO_ADMIN_PASSWORD = "demo-admin-pass-123";

export const DEMO_AUTHOR_EMAIL = "maya@demo.atmospherepress.test";
export const DEMO_AUTHOR_PASSWORD = "demo-author-pass-123";
export const DEMO_AUTHOR_NAME = "Maya Okafor";
export const DEMO_AUTHOR_HUBSPOT_CONTACT_ID = "demo-contact-1";

// ---------------------------------------------------------------------------
// Date helpers — approximate (30-day months), which is fine for fixture data. HubSpot date
// properties arrive as epoch-ms strings (see `parseDate` in `src/lib/hubspot/timeline.ts`), so
// every helper here returns one of those.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number, now: Date): string {
  return String(now.getTime() + days * DAY_MS);
}

export function monthsAgo(n: number, now: Date = new Date()): string {
  return daysFromNow(-n * 30, now);
}

export function weeksAgo(n: number, now: Date = new Date()): string {
  return daysFromNow(-n * 7, now);
}

export function monthsAhead(n: number, now: Date = new Date()): string {
  return daysFromNow(n * 30, now);
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export const DEMO_BOOK_1 = {
  hubspotProjectId: "demo-project-1",
  title: "The Orchard at Dusk",
  driveFolderId: DEMO_FOLDER_ID,
} as const;

export const DEMO_BOOK_2 = {
  hubspotProjectId: "demo-project-2",
  title: "Small Hours",
  driveFolderId: null as string | null,
} as const;

/** book_cache.properties for "The Orchard at Dusk" — mid-production, in interior design. */
export function demoBook1Properties(now: Date = new Date()): Record<string, string | null> {
  return {
    pipelineStage: "interior_design",
    package: "Premium",
    serviceAddOns: "Cold Reading;Hardcover",
    initiationDate: monthsAgo(8, now),
    teaser:
      "When Adaeze returns to her grandmother's failing orchard after a decade away, she means to sell it and leave before the blossoms turn. Instead she finds a town that never stopped waiting for her.",
    publicationDate: monthsAhead(3, now),

    bpm: "Claire Hart",
    pbc: "Devon Li",
    acquisitionsEditor: "Nick Courtright",

    developmentalEditor: "Sam Lee",
    developmentalEditorAssigned: monthsAgo(7, now),
    developmentalEditorStatus: "complete",

    proofreader: "Jo Park",
    proofreaderAssigned: monthsAgo(4, now),
    proofreaderStatus: "complete",

    coverDesigner: "Ana Ruiz",
    coverDesignerAssigned: monthsAgo(3, now),
    coverApprovalReceived: "yes",

    interiorDesigner: "Kai Moreno",
    interiorDesignerAssigned: weeksAgo(3, now),

    phone: "+1 512 555 0142",
    street: "118 Pecan Grove Ln",
    city: "Austin",
    region: "TX",
    postalCode: "78704",
    country: "USA",

    // Not a listed portal property (see src/lib/hubspot/properties.ts) — action_rules can key off
    // any cached property name, not just the ones the sync pipeline pre-declares.
    payment_status: "installment_due",

    // Milestone-driving raw HubSpot properties, namespaced "hs:<internalName>" the same way the
    // real sync pipeline caches them (see planSync's extraProperties handling) — makes the demo
    // "Cold read" and "NetGalley" milestones show something on /books/[bookId].
    "hs:cold_read_status": "Completed",
    "hs:netgalley": "Active",
    "hs:netgalley_start_date": weeksAgo(2, now),
  };
}

/** book_cache.properties for "Small Hours" — early, in developmental editing, no cover/interior yet. */
export function demoBook2Properties(now: Date = new Date()): Record<string, string | null> {
  return {
    pipelineStage: "developmental_editing",
    package: "Premium",
    initiationDate: weeksAgo(6, now),
    teaser: "A collection of linked short stories about the last hour before dawn in a small coastal town.",
    publicationDate: null,

    bpm: "Claire Hart",
    pbc: "Devon Li",
    acquisitionsEditor: "Nick Courtright",

    developmentalEditor: "Sam Lee",
    developmentalEditorAssigned: weeksAgo(4, now),
    developmentalEditorStatus: "in_progress",

    phone: "+1 512 555 0142",
    street: "118 Pecan Grove Ln",
    city: "Austin",
    region: "TX",
    postalCode: "78704",
    country: "USA",
  };
}

// ---------------------------------------------------------------------------
// stage_config — extend the default rows' hubspotValues so the two demo raw pipelineStage
// values resolve to a stage (see resolveStageKey in src/lib/hubspot/stages.ts).
// ---------------------------------------------------------------------------

export const DEMO_STAGE_HUBSPOT_VALUES: Array<{ key: string; hubspotValues: string[] }> = [
  { key: "developmental_editing", hubspotValues: ["developmental_editing", "Developmental Editing"] },
  { key: "interior_design", hubspotValues: ["interior_design", "Interior Design"] },
];

// ---------------------------------------------------------------------------
// property_display — friendly labels for raw dropdown values shown to the author.
// ---------------------------------------------------------------------------

export const DEMO_PROPERTY_DISPLAY: Array<{ propertyId: string; rawValue: string; label: string }> = [
  { propertyId: "developmentalEditorStatus", rawValue: "in_progress", label: "Your editor is working through your manuscript" },
  { propertyId: "developmentalEditorStatus", rawValue: "complete", label: "Complete" },
  { propertyId: "coverApprovalReceived", rawValue: "yes", label: "Approved" },
  { propertyId: "package", rawValue: "Premium", label: "Premium package" },
];

// ---------------------------------------------------------------------------
// action_rules
// ---------------------------------------------------------------------------

export const DEMO_ACTION_RULE = {
  propertyName: "payment_status",
  operator: "eq" as const,
  value: "installment_due",
  title: "Your second installment is due",
  message: "Production continues once it's received.",
  ctaLabel: "Pay now",
  ctaUrl: "https://atmospherepress.com/investment-portal",
};

// ---------------------------------------------------------------------------
// visible_files — book 1 only, pointing at the fixture Drive files served by
// src/lib/drive/fixture.ts.
// ---------------------------------------------------------------------------

export const DEMO_VISIBLE_FILES: Array<{ driveFileId: string; label: string; category: string; mimeType: string }> = [
  { driveFileId: "demo-cover", label: "Final cover", category: "Cover", mimeType: "image/svg+xml" },
  { driveFileId: "demo-blurb", label: "Back-cover blurb", category: "Blurb", mimeType: "application/pdf" },
];

// ---------------------------------------------------------------------------
// notes — one note visible to the author, on book 1.
// ---------------------------------------------------------------------------

export const DEMO_NOTE_BODY = "Your interior proof PDF should reach you next week.";

// ---------------------------------------------------------------------------
// handbook
// ---------------------------------------------------------------------------

export const DEMO_HANDBOOK_FILENAME = "demo-handbook.md";
