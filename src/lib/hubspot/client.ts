import "server-only";
import { Client } from "@hubspot/api-client";
import { env } from "@/lib/env";
import type { HubSpotContactWriter } from "./writes";

/**
 * Read-only view of a HubSpot "Project" (the custom object configured by
 * `HUBSPOT_PROJECT_OBJECT_TYPE`) as the sync layer needs it. `properties` is keyed by the raw
 * HubSpot internal property name (not the portal id) — callers re-key with
 * `pickPortalProperties` from `./properties.ts`.
 */
export type HubSpotProject = {
  id: string;
  properties: Record<string, string | null>;
  updatedAt: Date;
  contactIds: string[];
};

export type HubSpotSchemaProperty = {
  name: string;
  label: string;
  type: string;
  options?: { label: string; value: string }[];
};

export type HubSpotContactSummary = {
  id: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
};

/**
 * Thin, mockable wrapper over the parts of the HubSpot API the sync layer reads. The concrete
 * implementation below (`HubSpotApiClient`) is the only reader; `src/lib/hubspot/sync.ts` and
 * `contact-info.ts` depend only on this interface so they can be tested with a fake.
 */
export interface HubSpotReader {
  getProjectSchema(): Promise<{ properties: HubSpotSchemaProperty[] }>;
  /** 100 results per page (HubSpot's search page size cap). */
  searchProjectsModifiedSince(since: Date | null, after?: string): Promise<{ results: HubSpotProject[]; nextAfter?: string }>;
  getProject(id: string): Promise<HubSpotProject | null>;
  /** Batch read, chunked internally to HubSpot's 100-per-call limit. */
  getContactsByIds(ids: string[]): Promise<Map<string, HubSpotContactSummary>>;
  /**
   * All Projects associated with one Contact. Not part of the brief's original interface sketch,
   * but needed to implement `syncAuthor` (the admin "Refresh from HubSpot" button) — without it,
   * a refresh could only re-pull books we already know about, never discover a brand-new one.
   * Assumes an author has a small (single-digit) number of books, so no pagination.
   */
  getProjectsForContact(contactId: string): Promise<HubSpotProject[]>;
  /**
   * HubSpot owner id -> { name, email }, active and archived owners alike (former staff still
   * appear on old Projects). Team properties (BPM, DE, PR, …) reference owners, so the sync stores
   * names (and, since the portal's "primary contact" needs to email that person, their address too).
   * Needs the `crm.objects.owners.read` scope; callers treat a failure as "no names available".
   */
  getOwners(): Promise<Map<string, { name: string; email: string | null }>>;
}

// ---------------------------------------------------------------------------
// Retry: HubSpot's SDK has its own optional retry/backoff, but it isn't exponential and doesn't
// give us a hook to count attempts precisely, so we disable it (`numberOfApiCallRetries: 0`) and
// wrap every call ourselves. Concurrency (max 4 in flight) is delegated to the SDK's built-in
// Bottleneck limiter (`limiterOptions`) rather than re-implemented here.
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(code: unknown): code is number {
  return code === 429 || code === 502 || code === 503 || code === 504;
}

/** Exponential backoff with jitter, capped at 15s between attempts; honours Retry-After when present. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (!isRetryableStatus(code) || attempt >= MAX_RETRIES) throw err;
      attempt++;
      const headers = (err as { headers?: Record<string, string> } | null)?.headers;
      const retryAfterHeader = headers?.["retry-after"] ?? headers?.["Retry-After"];
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
      const backoffMs = retryAfterMs && Number.isFinite(retryAfterMs) ? retryAfterMs : Math.min(500 * 2 ** attempt, 15_000);
      await sleep(backoffMs + Math.random() * 250);
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const SCHEMA_TTL_MS = 5 * 60 * 1000;
const PROJECT_TO_CONTACT_ASSOCIATION = "contacts";

class HubSpotApiClient implements HubSpotReader, HubSpotContactWriter {
  private readonly client: Client;
  private readonly objectType: string;
  private schemaCache: { properties: HubSpotSchemaProperty[]; fetchedAt: number } | null = null;

  constructor(accessToken: string, objectType: string) {
    this.client = new Client({
      accessToken,
      numberOfApiCallRetries: 0, // we do our own retry, see withRetry()
      limiterOptions: { maxConcurrent: 4, minTime: Math.ceil(1000 / 9), id: "atmosphere-author-portal" },
    });
    this.objectType = objectType;
  }

  async getProjectSchema(): Promise<{ properties: HubSpotSchemaProperty[] }> {
    const now = Date.now();
    if (this.schemaCache && now - this.schemaCache.fetchedAt < SCHEMA_TTL_MS) {
      return { properties: this.schemaCache.properties };
    }
    const res = await withRetry(() => this.client.crm.properties.coreApi.getAll(this.objectType));
    const properties: HubSpotSchemaProperty[] = res.results.map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      options: p.options?.length ? p.options.map((o) => ({ label: o.label, value: o.value })) : undefined,
    }));
    this.schemaCache = { properties, fetchedAt: now };
    return { properties };
  }

  private async schemaPropertyNames(): Promise<string[]> {
    const { properties } = await this.getProjectSchema();
    return properties.map((p) => p.name);
  }

  /** Batch-fetch Project→Contact associations for up to 100 project ids per call. */
  private async attachContactIds(projectIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (projectIds.length === 0) return out;
    for (const idsChunk of chunk(projectIds, 100)) {
      const res = await withRetry(() =>
        this.client.crm.associations.v4.batchApi.getPage(this.objectType, PROJECT_TO_CONTACT_ASSOCIATION, {
          inputs: idsChunk.map((id) => ({ id })),
        }),
      );
      for (const r of res.results) {
        out.set(r._from.id, r.to.map((t) => t.toObjectId));
      }
    }
    return out;
  }

  async searchProjectsModifiedSince(since: Date | null, after?: string): Promise<{ results: HubSpotProject[]; nextAfter?: string }> {
    const properties = await this.schemaPropertyNames();
    const searchRequest = {
      filterGroups: since
        ? [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(since.getTime()) }] }]
        : [],
      sorts: ["hs_lastmodifieddate"],
      properties,
      limit: 100,
      after,
      // Generated SDK types want a class instance (with an enum-typed `operator`); a matching
      // plain object is accepted at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const res = await withRetry(() => this.client.crm.objects.searchApi.doSearch(this.objectType, searchRequest));
    const contactIdsByProject = await this.attachContactIds(res.results.map((r) => r.id));
    const results: HubSpotProject[] = res.results.map((r) => ({
      id: r.id,
      properties: r.properties,
      updatedAt: new Date(r.updatedAt),
      contactIds: contactIdsByProject.get(r.id) ?? [],
    }));
    return { results, nextAfter: res.paging?.next?.after };
  }

  async getProject(id: string): Promise<HubSpotProject | null> {
    const properties = await this.schemaPropertyNames();
    try {
      const res = await withRetry(() =>
        this.client.crm.objects.basicApi.getById(this.objectType, id, properties, undefined, [PROJECT_TO_CONTACT_ASSOCIATION]),
      );
      const contactIds = res.associations?.[PROJECT_TO_CONTACT_ASSOCIATION]?.results?.map((a) => a.id) ?? [];
      return { id: res.id, properties: res.properties, updatedAt: new Date(res.updatedAt), contactIds };
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === 404) return null;
      throw err;
    }
  }

  async getProjectsForContact(contactId: string): Promise<HubSpotProject[]> {
    const res = await withRetry(() =>
      this.client.crm.associations.v4.batchApi.getPage(PROJECT_TO_CONTACT_ASSOCIATION, this.objectType, {
        inputs: [{ id: contactId }],
      }),
    );
    const projectIds = res.results[0]?.to.map((t) => t.toObjectId) ?? [];
    const projects = await Promise.all(projectIds.map((id) => this.getProject(id)));
    return projects.filter((p): p is HubSpotProject => p !== null);
  }

  async getOwners(): Promise<Map<string, { name: string; email: string | null }>> {
    const out = new Map<string, { name: string; email: string | null }>();
    for (const archived of [false, true]) {
      let after: string | undefined;
      do {
        const res = await withRetry(() => this.client.crm.owners.ownersApi.getPage(undefined, after, 500, archived));
        for (const o of res.results) {
          const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.id);
          const entry = { name, email: o.email ?? null };
          out.set(String(o.id), entry);
          if (o.userId != null) out.set(String(o.userId), entry);
        }
        after = res.paging?.next?.after;
      } while (after);
    }
    return out;
  }

  async getContactsByIds(ids: string[]): Promise<Map<string, HubSpotContactSummary>> {
    const out = new Map<string, HubSpotContactSummary>();
    const uniqueIds = [...new Set(ids)];
    for (const idsChunk of chunk(uniqueIds, 100)) {
      if (idsChunk.length === 0) continue;
      const res = await withRetry(() =>
        this.client.crm.contacts.batchApi.read({
          inputs: idsChunk.map((id) => ({ id })),
          properties: ["email", "firstname", "lastname"],
          propertiesWithHistory: [],
        }),
      );
      for (const c of res.results) {
        out.set(c.id, {
          id: c.id,
          email: c.properties.email ?? null,
          firstname: c.properties.firstname ?? null,
          lastname: c.properties.lastname ?? null,
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // HubSpotContactWriter — THE ONLY mutating HubSpot calls anywhere in the codebase, alongside
  // src/lib/hubspot/writes.ts (which contains none itself, only the pure planning + interface).
  // `writes.test.ts`'s guard fails the build if any other file matches these call patterns.
  // -------------------------------------------------------------------------

  async updateContactProperties(contactId: string, properties: Record<string, string>): Promise<void> {
    await withRetry(() => this.client.crm.contacts.basicApi.update(contactId, { properties }));
  }

  async updateProjectProperties(projectId: string, properties: Record<string, string>): Promise<void> {
    await withRetry(() => this.client.crm.objects.basicApi.update(this.objectType, projectId, { properties }));
  }
}

let singleton: HubSpotApiClient | null = null;

function getClient(): HubSpotApiClient {
  if (!singleton) {
    if (!env.HUBSPOT_ACCESS_TOKEN) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");
    if (!env.HUBSPOT_PROJECT_OBJECT_TYPE) throw new Error("HUBSPOT_PROJECT_OBJECT_TYPE is not configured");
    singleton = new HubSpotApiClient(env.HUBSPOT_ACCESS_TOKEN, env.HUBSPOT_PROJECT_OBJECT_TYPE);
  }
  return singleton;
}

export function getHubSpotReader(): HubSpotReader {
  return getClient();
}

export function getHubSpotWriter(): HubSpotContactWriter {
  return getClient();
}
