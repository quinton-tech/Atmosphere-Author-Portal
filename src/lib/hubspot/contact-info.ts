import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, auditLog, bookCache, books, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isDemoMode } from "@/lib/env";
import { getHubSpotReader, getHubSpotWriter } from "./client";
import { resolveInternalNames, type PropertyMap } from "./properties";
import {
  CONTACT_INFO_MAX_UPDATES_PER_DAY,
  WRITABLE_CONTACT_FIELDS,
  contactInfoSchema,
  planContactInfoPatch,
  type ContactInfoInput,
  type ContactInfoTarget,
  type WritableContactField,
} from "./writes";

/** Thrown with copy that's safe to show an author directly (see brief: "throw a user-safe error"). */
export class ContactInfoError extends Error {}

/**
 * Standard HubSpot Contact property internal names for the fields authors may edit. HubSpotReader
 * only exposes `getProjectSchema()` (the Project object), not a Contact-schema lookup, so when
 * `contactInfoTarget` is "contact" there's no way to resolve these dynamically from a live schema
 * the way Project properties are. These are HubSpot's own default contact property names; override
 * per-portal via `app_settings.propertyMap` if a portal uses custom ones instead.
 */
const DEFAULT_CONTACT_PROPERTY_MAP: PropertyMap = {
  phone: "phone",
  street: "address",
  city: "city",
  region: "state",
  postalCode: "zip",
  country: "country",
};

async function getAppSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row ? (row.value as T) : null;
}

async function resolveContactInfoMap(target: ContactInfoTarget, overrides: PropertyMap): Promise<PropertyMap> {
  if (target === "contact") {
    return { ...DEFAULT_CONTACT_PROPERTY_MAP, ...overrides };
  }
  const schema = await getHubSpotReader().getProjectSchema();
  const { map } = resolveInternalNames(schema.properties, overrides);
  return map;
}

function fieldsToRecord(fields: readonly WritableContactField[], current: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(fields.map((f) => [f, current[f] ?? null]));
}

/**
 * An author updates their own phone/address. Per CLAUDE.md's hard rule: validated with zod,
 * written to HubSpot first, then mirrored into the canonical profile (`users`), and audited with
 * before/after. Throttled to `CONTACT_INFO_MAX_UPDATES_PER_DAY` per user per rolling 24h, counted
 * from `audit_log`.
 */
export async function updateAuthorContactInfo(
  userId: string,
  rawInput: unknown,
): Promise<{ ok: true; changed: WritableContactField[]; unmapped: WritableContactField[] }> {
  const input: ContactInfoInput = contactInfoSchema.parse(rawInput);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ContactInfoError("We couldn't find your account. Please sign in again.");
  if (!user.hubspotContactId) {
    throw new ContactInfoError("Your account isn't linked to HubSpot yet. Contact your Author Manager.");
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentUpdates = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.actorId, userId), eq(auditLog.action, "author.contact_info.update"), gte(auditLog.createdAt, since)))
    .limit(CONTACT_INFO_MAX_UPDATES_PER_DAY);
  if (recentUpdates.length >= CONTACT_INFO_MAX_UPDATES_PER_DAY) {
    throw new ContactInfoError("You've reached today's limit for contact info updates. Please try again tomorrow.");
  }

  const userBooks = await db.select({ id: books.id, hubspotProjectId: books.hubspotProjectId }).from(books).where(eq(books.userId, userId));

  const [target, overrides] = await Promise.all([
    getAppSetting<ContactInfoTarget>("contactInfoTarget").then((t) => t ?? "contact"),
    getAppSetting<PropertyMap>("propertyMap").then((m) => m ?? {}),
  ]);

  // The Contact is the canonical profile (`users` columns, kept current by `applyPlan` at sync time
  // and by every successful call here — see review finding #1), so diff against that when writing
  // to the Contact. Writing to the Project instead means the Project's own cached properties are
  // the field's actual current value in HubSpot, so diff against those.
  let current: Record<string, string | null>;
  if (target === "contact") {
    current = fieldsToRecord(WRITABLE_CONTACT_FIELDS, {
      phone: user.phone,
      street: user.street,
      city: user.city,
      region: user.region,
      postalCode: user.postalCode,
      country: user.country,
    });
  } else {
    const mostRecentCache = userBooks.length
      ? (
          await db
            .select()
            .from(bookCache)
            .where(inArray(bookCache.bookId, userBooks.map((b) => b.id)))
            .orderBy(desc(bookCache.syncedAt))
            .limit(1)
        )[0]
      : undefined;
    current = mostRecentCache?.properties ?? {};
  }

  const map = await resolveContactInfoMap(target, overrides);
  const { patch, changed, unmapped } = planContactInfoPatch(input, current, map);

  if (Object.keys(patch).length === 0) {
    return { ok: true, changed: [], unmapped };
  }

  if (target === "project" && userBooks.length === 0) {
    throw new ContactInfoError("You don't have a book on file yet. Contact your Author Manager.");
  }

  // Demo mode has no HUBSPOT_ACCESS_TOKEN, so there's no HubSpot to write to — skip straight to
  // mirroring the change into our own cache below, so the Account form still works end to end.
  if (!isDemoMode()) {
    const writer = getHubSpotWriter();
    try {
      if (target === "contact") {
        await writer.updateContactProperties(user.hubspotContactId, patch);
      } else {
        await Promise.all(userBooks.map((b) => writer.updateProjectProperties(b.hubspotProjectId, patch)));
      }
    } catch (err) {
      await audit(userId, "author.contact_info.failed", {
        targetType: target,
        targetId: user.hubspotContactId,
        meta: { fields: changed, error: err instanceof Error ? err.message : String(err) },
      });
      throw new ContactInfoError("We couldn't save your changes. Please try again in a moment or contact your Author Manager.");
    }
  }

  // Mirror into the canonical profile (`users`) so the portal reflects the change immediately,
  // without waiting for the next sync to re-pull the Contact — regardless of which HubSpot object
  // was just written to. Book caches are no longer touched here: Project properties come back on
  // their own schedule via sync, and are never the author-facing profile's source of truth.
  const patchByPortalId = Object.fromEntries(changed.map((field) => [field, input[field] as string])) as Partial<
    Record<WritableContactField, string>
  >;
  if (changed.length > 0) {
    await db
      .update(users)
      .set({ ...patchByPortalId, profileSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  const before = fieldsToRecord(WRITABLE_CONTACT_FIELDS, current);
  const after = { ...before, ...patchByPortalId };
  await audit(userId, "author.contact_info.update", {
    targetType: target,
    targetId: user.hubspotContactId,
    meta: { before, after, target },
  });

  return { ok: true, changed, unmapped };
}
