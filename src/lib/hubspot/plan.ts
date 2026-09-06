/**
 * Pure sync planning: given a batch of HubSpot Projects + the Contacts they're associated with +
 * stage config + the resolved property map, compute the DB rows to upsert. No HubSpot or DB calls
 * happen in here — that's what makes it unit-testable (see sync.test.ts) and, just as important,
 * what keeps it free of the `server-only` import that `sync.ts` (and everything it imports from
 * `@/db` / `@/lib/env`) carries. `server-only` throws outside a bundler that resolves the
 * "react-server" export condition, which vitest's default Node/Vite runner does not — so this
 * pure module has to have zero transitive dependency on `@/db` or `@/lib/env` for `sync.test.ts`
 * to be able to import it at all. Only type-only imports are taken from `./client`, which are
 * fully erased at compile time and so never trigger `client.ts`'s (real, deliberate) `server-only`
 * guard.
 */
import { PROJECT_PROPERTIES, pickPortalProperties, type PropertyMap } from "./properties";
import { resolveStageKey } from "./stages";
import type { HubSpotContactSummary, HubSpotProject, HubSpotReader } from "./client";
import type { StageConfig } from "@/db/schema";

export type PlannedUser = {
  email: string; // lowercased — the HubSpot join key
  hubspotContactId: string;
  name: string | null;
};

export type PlannedBook = {
  hubspotProjectId: string;
  title: string;
  /** Links to a PlannedUser.email, resolved to a real userId by sync.ts's applyPlan(). */
  authorEmail: string;
};

export type PlannedCache = {
  /** Links to a PlannedBook.hubspotProjectId, resolved to a real bookId by sync.ts's applyPlan(). */
  hubspotProjectId: string;
  properties: Record<string, string | null>; // portal-id keyed, only PROJECT_PROPERTIES entries
  stageKey: string | null;
  hubspotUpdatedAt: Date;
};

export type SyncPlan = {
  users: PlannedUser[];
  books: PlannedBook[];
  caches: PlannedCache[];
  /** Project ids with no associated contact, or an associated contact with no email on file. */
  unmatchedProjectIds: string[];
  /** portal property id -> distinct raw enum values observed, for admin's property_display editor. */
  enumValuesSeen: Record<string, string[]>;
};

const ENUM_PROPERTY_IDS = new Set(PROJECT_PROPERTIES.filter((p) => p.kind === "enum").map((p) => p.id));
const PERSON_PROPERTY_IDS = PROJECT_PROPERTIES.filter((p) => p.kind === "person").map((p) => p.id);

/** Team fields hold HubSpot owner ids; swap in names when we have them, else leave the id. */
export function resolvePersonNames(props: Record<string, string | null>, owners: Map<string, string> | undefined): Record<string, string | null> {
  if (!owners?.size) return props;
  const out = { ...props };
  for (const id of PERSON_PROPERTY_IDS) {
    const v = out[id];
    if (v && owners.has(v)) out[id] = owners.get(v)!;
  }
  return out;
}

export function planSync(
  projects: HubSpotProject[],
  contacts: Map<string, HubSpotContactSummary>,
  stages: Pick<StageConfig, "key" | "hubspotValues">[],
  propertyMap: PropertyMap,
  opts: { titleProperty?: string; stageProperty?: string; owners?: Map<string, string> } = {},
): SyncPlan {
  const titleProperty = opts.titleProperty ?? "name";
  const usersByEmail = new Map<string, PlannedUser>();
  const plannedBooks: PlannedBook[] = [];
  const caches: PlannedCache[] = [];
  const unmatchedProjectIds: string[] = [];
  const enumValuesSeen: Record<string, Set<string>> = {};

  for (const project of projects) {
    const portalProps = resolvePersonNames(pickPortalProperties(project.properties, propertyMap), opts.owners);

    for (const id of ENUM_PROPERTY_IDS) {
      const v = portalProps[id];
      if (v) (enumValuesSeen[id] ??= new Set()).add(v);
    }

    const contact = project.contactIds.map((id) => contacts.get(id)).find((c): c is HubSpotContactSummary => !!c?.email);
    if (!contact?.email) {
      unmatchedProjectIds.push(project.id);
      continue;
    }
    const email = contact.email.trim().toLowerCase();
    if (!usersByEmail.has(email)) {
      const name = [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() || null;
      usersByEmail.set(email, { email, hubspotContactId: contact.id, name });
    }

    const title = project.properties[titleProperty]?.trim() || "Untitled";
    plannedBooks.push({ hubspotProjectId: project.id, title, authorEmail: email });

    const stageKey = resolveStageKey(portalProps, stages, opts.stageProperty);
    caches.push({ hubspotProjectId: project.id, properties: portalProps, stageKey, hubspotUpdatedAt: project.updatedAt });
  }

  return {
    users: [...usersByEmail.values()],
    books: plannedBooks,
    caches,
    unmatchedProjectIds,
    enumValuesSeen: Object.fromEntries(Object.entries(enumValuesSeen).map(([id, values]) => [id, [...values]])),
  };
}

/** Fetch one page of Projects + their Contacts and plan it. No DB access — testable with a fake HubSpotReader. */
export async function fetchAndPlanPage(
  reader: HubSpotReader,
  since: Date | null,
  after: string | undefined,
  config: { stages: Pick<StageConfig, "key" | "hubspotValues">[]; propertyMap: PropertyMap; titleProperty: string; owners?: Map<string, string> },
): Promise<{ plan: SyncPlan; nextAfter?: string }> {
  const page = await reader.searchProjectsModifiedSince(since, after);
  const contactIds = [...new Set(page.results.flatMap((p) => p.contactIds))];
  const contacts = await reader.getContactsByIds(contactIds);
  const plan = planSync(page.results, contacts, config.stages, config.propertyMap, { titleProperty: config.titleProperty, owners: config.owners });
  return { plan, nextAfter: page.nextAfter };
}
