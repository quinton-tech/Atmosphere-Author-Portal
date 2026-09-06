/**
 * The HubSpot "Project" properties the portal displays, keyed by a stable portal id.
 * `label` is the HubSpot display label as given by staff. `internalName` is the HubSpot
 * API name; it is resolved at sync time from the object schema (see resolveInternalNames)
 * and overridable via app_settings.propertyMap. Anything not listed here is NOT cached.
 */

export type PropertyKind = "text" | "date" | "enum" | "person" | "email" | "phone";

export type PortalProperty = {
  id: string;
  label: string;
  kind: PropertyKind;
  /** Where it shows up. */
  group: "production" | "team" | "author";
  /** Author-facing label; falls back to `label`. */
  friendly?: string;
  internalName?: string;
};

export const PROJECT_PROPERTIES: PortalProperty[] = [
  // Production
  { id: "pipelineStage", label: "Pipeline Stage", kind: "enum", group: "production", friendly: "Current stage" },
  { id: "initiationDate", label: "Initiation Date", kind: "date", group: "production", friendly: "Project started" },
  { id: "package", label: "Package", kind: "enum", group: "production" },
  // Multi-select checkbox property; HubSpot stores selected values joined by ";" (e.g.
  // "Hardcover;Cold Reading"). Cached raw so milestone include-rules can check membership.
  { id: "serviceAddOns", label: "Service Add-ons", kind: "enum", group: "production" },
  { id: "teaser", label: "Description/Teaser Final", kind: "text", group: "production", friendly: "Your book's teaser" },
  { id: "publicationDate", label: "Publication Date (Claire-only)", kind: "date", group: "production", friendly: "Publication date" },
  // HubSpot's own record-creation timestamp. Used only to detect "date entered <stage>" values that
  // are migration artifacts (the record was bulk-imported into HubSpot, not actually entering that
  // stage that day) — see sanitiseStageEnteredAt in data/books.ts.
  { id: "recordCreated", label: "Create Date", kind: "date", group: "production", internalName: "hs_createdate" },

  // Author website. The "* " on the real HubSpot label is part of the label itself (not a
  // markdown/required-field marker we're stripping), so `internalName` is set explicitly rather
  // than relying on label matching for this one property.
  { id: "websiteUrl", label: "* Author Website URL", kind: "text", group: "production", internalName: "website_url" },
  { id: "websiteStatus", label: "AW Production Status", kind: "enum", group: "production" },
  { id: "websitePackage", label: "AW Package (maintaining)", kind: "enum", group: "production" },
  { id: "websiteDomainExpiry", label: "AW Domain Expiration Date", kind: "date", group: "production" },
  { id: "websiteDomain", label: "AW Final Domain", kind: "text", group: "production" },

  // Team (person + assigned date + status triples)
  { id: "bpm", label: "BPM", kind: "person", group: "team", friendly: "Book Production Manager" },
  { id: "pbc", label: "PBC", kind: "person", group: "team", friendly: "Publishing Coordinator" },
  { id: "acquisitionsEditor", label: "AE", kind: "person", group: "team", friendly: "Acquisitions Editor" },
  { id: "developmentalEditor", label: "DE", kind: "person", group: "team", friendly: "Developmental Editor" },
  { id: "developmentalEditorAssigned", label: "DE Assigned", kind: "date", group: "team" },
  { id: "developmentalEditorStatus", label: "DE Status", kind: "enum", group: "team" },
  { id: "proofreader", label: "PR", kind: "person", group: "team", friendly: "Proofreader" },
  { id: "proofreaderAssigned", label: "PR Assigned", kind: "date", group: "team" },
  { id: "proofreaderStatus", label: "Pr status", kind: "enum", group: "team" },
  { id: "interiorDesigner", label: "ID", kind: "person", group: "team", friendly: "Interior Designer" },
  { id: "interiorDesignerAssigned", label: "ID assigned", kind: "date", group: "team" },
  { id: "coverDesigner", label: "CD", kind: "person", group: "team", friendly: "Cover Designer" },
  { id: "coverDesignerAssigned", label: "CD Assigned", kind: "date", group: "team" },
  { id: "coverApprovalReceived", label: "Approval Received", kind: "enum", group: "team", friendly: "Cover approval" },

  // Author contact info (shown read-only on the Account page)
  { id: "phone", label: "Phone Number", kind: "phone", group: "author" },
  { id: "authorEmail", label: "Author Email", kind: "email", group: "author" },
  { id: "street", label: "Street Address", kind: "text", group: "author" },
  { id: "city", label: "City", kind: "text", group: "author" },
  { id: "region", label: "State/Region", kind: "text", group: "author" },
  { id: "postalCode", label: "Postal Code", kind: "text", group: "author" },
  { id: "country", label: "Country", kind: "text", group: "author" },
];

/** Staff-described roles and which person/date/status properties describe them. */
export const TEAM_ROLES = [
  { role: "Book Production Manager", person: "bpm" },
  { role: "Publishing Coordinator", person: "pbc" },
  { role: "Acquisitions Editor", person: "acquisitionsEditor" },
  { role: "Developmental Editor", person: "developmentalEditor", assigned: "developmentalEditorAssigned", status: "developmentalEditorStatus" },
  { role: "Proofreader", person: "proofreader", assigned: "proofreaderAssigned", status: "proofreaderStatus" },
  { role: "Cover Designer", person: "coverDesigner", assigned: "coverDesignerAssigned", status: "coverApprovalReceived" },
  { role: "Interior Designer", person: "interiorDesigner", assigned: "interiorDesignerAssigned" },
] as const;

export type PropertyMap = Record<string, string>; // portal id -> HubSpot internal name

function normLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Given the HubSpot object schema, match each portal property to an internal name by label
 * (exact, then normalised). `overrides` (from app_settings.propertyMap) win. Returns the map and
 * the ids that could not be resolved so admin Health can show them.
 */
export function resolveInternalNames(
  schemaProps: { name: string; label: string }[],
  overrides: PropertyMap = {},
): { map: PropertyMap; unresolved: string[] } {
  const byExact = new Map(schemaProps.map((p) => [p.label, p.name]));
  const byNorm = new Map(schemaProps.map((p) => [normLabel(p.label), p.name]));
  const byName = new Set(schemaProps.map((p) => p.name));
  const map: PropertyMap = {};
  const unresolved: string[] = [];
  for (const p of PROJECT_PROPERTIES) {
    const hit =
      overrides[p.id] ??
      p.internalName ??
      byExact.get(p.label) ??
      byNorm.get(normLabel(p.label)) ??
      (byName.has(p.label) ? p.label : undefined);
    if (hit) map[p.id] = hit;
    else unresolved.push(p.id);
  }
  return { map, unresolved };
}

/** Pick only mapped properties out of a raw HubSpot record, re-keyed by portal id. */
export function pickPortalProperties(raw: Record<string, string | null>, map: PropertyMap): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [id, internal] of Object.entries(map)) {
    if (internal in raw) out[id] = raw[internal];
  }
  return out;
}
