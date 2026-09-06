import "server-only";
import { Client } from "@hubspot/api-client";
import { env } from "@/lib/env";
import { EMAIL_PROPERTIES, mapAndFilterEmails, type ContactEmailRecord, type RawHubSpotEmail } from "./engagements-map";

/**
 * Read-only access to HubSpot Engagement Emails (the CRM `emails` object — engagement type
 * EMAIL / INCOMING_EMAIL) logged on a Contact record, for the author-facing "Messages from your
 * team" feature. This file makes NO mutating HubSpot calls (no create/update/archive/merge) —
 * see CLAUDE.md's hard rule and `src/lib/hubspot/writes.test.ts`'s guard, which fails the build
 * if any file outside `writes.ts`/`client.ts` matches a mutating call pattern.
 *
 * Deliberately its own client instance (same access token, same retry/backoff shape as
 * `src/lib/hubspot/client.ts`) rather than reusing that module, so this read-only surface stays
 * fully independent of the writer-capable one.
 *
 * Never fetches notes, calls, tasks, or meetings — emails only, and only ones the author actually
 * participated in. The pure mapping/filtering (including that participation check) lives in
 * `./engagements-map.ts`, which has no "server-only"/env/network dependency and is unit tested
 * directly in `./engagements.test.ts`.
 */

export type { ContactEmailRecord } from "./engagements-map";

const SCOPE_ERROR_CODE = 403;

/** Thrown when HubSpot rejects a call for missing scope (`sales-email-read`). Caller shows a
 *  "messages aren't available yet" state instead of erroring. */
export class EngagementsScopeError extends Error {}

// ---------------------------------------------------------------------------
// Retry/backoff — copied from src/lib/hubspot/client.ts's `withRetry` (kept duplicated rather than
// imported so this read-only module has zero dependency on the writer-capable client file).
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(code: unknown): code is number {
  return code === 429 || code === 502 || code === 503 || code === 504;
}

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

function asScopeError(err: unknown): EngagementsScopeError | null {
  const code = (err as { code?: unknown } | null)?.code;
  return code === SCOPE_ERROR_CODE ? new EngagementsScopeError("HubSpot rejected the request (missing sales-email-read scope)") : null;
}

const CONTACT_TO_EMAIL_FROM_TYPE = "contacts";
const CONTACT_TO_EMAIL_TO_TYPE = "emails";
/** Bound on how many associated email ids we'll ever page through for one contact, before mapping
 *  down to the 200 most recent — keeps a very chatty contact from causing unbounded work. */
const MAX_ASSOCIATION_IDS = 1000;

class HubSpotEngagementsClient {
  private readonly client: Client;

  constructor(accessToken: string) {
    this.client = new Client({
      accessToken,
      numberOfApiCallRetries: 0, // we do our own retry, see withRetry()
      limiterOptions: { maxConcurrent: 4, minTime: Math.ceil(1000 / 9), id: "atmosphere-author-portal-engagements" },
    });
  }

  /** All `emails` object ids associated with one contact, paginated. */
  private async listAssociatedEmailIds(contactId: string): Promise<string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    do {
      let res;
      try {
        res = await withRetry(() =>
          this.client.crm.associations.v4.batchApi.getPage(CONTACT_TO_EMAIL_FROM_TYPE, CONTACT_TO_EMAIL_TO_TYPE, {
            inputs: [{ id: contactId, after }],
          }),
        );
      } catch (err) {
        throw asScopeError(err) ?? err;
      }
      const result = res.results[0];
      for (const t of result?.to ?? []) ids.push(t.toObjectId);
      after = result?.paging?.next?.after;
    } while (after && ids.length < MAX_ASSOCIATION_IDS);
    return ids;
  }

  /** Batch-read `emails` objects by id, chunked to HubSpot's 100-per-call limit. */
  private async getEmailsByIds(ids: string[]): Promise<RawHubSpotEmail[]> {
    const out: RawHubSpotEmail[] = [];
    for (const idsChunk of chunk(ids, 100)) {
      if (idsChunk.length === 0) continue;
      let res;
      try {
        res = await withRetry(() =>
          this.client.crm.objects.emails.batchApi.read({
            inputs: idsChunk.map((id) => ({ id })),
            properties: [...EMAIL_PROPERTIES],
            propertiesWithHistory: [],
          }),
        );
      } catch (err) {
        throw asScopeError(err) ?? err;
      }
      for (const r of res.results) out.push({ id: r.id, properties: r.properties as RawHubSpotEmail["properties"] });
    }
    return out;
  }

  /** All emails logged on `contactId` that `authorEmail` participated in, newest first, capped at
   *  200. Throws `EngagementsScopeError` if the token lacks `sales-email-read`. */
  async fetchContactEmails(contactId: string, authorEmail: string): Promise<ContactEmailRecord[]> {
    const ids = await this.listAssociatedEmailIds(contactId);
    if (ids.length === 0) return [];
    const raw = await this.getEmailsByIds(ids);
    return mapAndFilterEmails(raw, authorEmail);
  }
}

let singleton: HubSpotEngagementsClient | null = null;

function getEngagementsClient(): HubSpotEngagementsClient {
  if (!singleton) {
    if (!env.HUBSPOT_ACCESS_TOKEN) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");
    singleton = new HubSpotEngagementsClient(env.HUBSPOT_ACCESS_TOKEN);
  }
  return singleton;
}

/** All emails logged on `contactId` that `authorEmail` participated in (from/to/cc), newest
 *  first, capped at 200. Only ever reads the `emails` engagement object — never notes, calls,
 *  tasks, or meetings. Throws `EngagementsScopeError` on a 403 (missing `sales-email-read`). */
export async function fetchContactEmails(contactId: string, authorEmail: string): Promise<ContactEmailRecord[]> {
  return getEngagementsClient().fetchContactEmails(contactId, authorEmail);
}
