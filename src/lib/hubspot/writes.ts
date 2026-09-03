/**
 * THE ONLY PLACE THAT WRITES TO HUBSPOT.
 *
 * Authors may update their own contact details (phone, postal address). Nothing else in the
 * codebase may call a HubSpot create/update/archive method; `writes.guard.test.ts` enforces this.
 *
 * Email is deliberately NOT self-service: it is the login identity and the join key to HubSpot.
 * Authors are told to contact their Author Manager to change it.
 */
import { z } from "zod";
import type { PropertyMap } from "./properties";

/** Portal ids an author may change. Keep this list short and boring. */
export const WRITABLE_CONTACT_FIELDS = ["phone", "street", "city", "region", "postalCode", "country"] as const;
export type WritableContactField = (typeof WRITABLE_CONTACT_FIELDS)[number];

export const contactInfoSchema = z.object({
  phone: z.string().trim().max(40).regex(/^[+\d\s().-]*$/, "Use digits, spaces, + ( ) . -").optional(),
  street: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
});
export type ContactInfoInput = z.infer<typeof contactInfoSchema>;

/** Where the contact fields live in HubSpot. Set in app_settings.contactInfoTarget; default "contact". */
export type ContactInfoTarget = "contact" | "project";

/** Minimal writer interface so the real client can be mocked and its surface stays tiny. */
export interface HubSpotContactWriter {
  updateContactProperties(contactId: string, properties: Record<string, string>): Promise<void>;
  updateProjectProperties(projectId: string, properties: Record<string, string>): Promise<void>;
}

/**
 * Pure: compute the exact HubSpot property patch for a change request.
 * - Drops fields not in the allow-list or not present in the property map.
 * - Drops unchanged values so we never issue no-op writes.
 * - Returns `unmapped` so the UI can say "this field can't be changed here yet".
 */
export function planContactInfoPatch(
  input: ContactInfoInput,
  current: Record<string, string | null>,
  map: PropertyMap,
): { patch: Record<string, string>; changed: WritableContactField[]; unmapped: WritableContactField[] } {
  const patch: Record<string, string> = {};
  const changed: WritableContactField[] = [];
  const unmapped: WritableContactField[] = [];
  for (const field of WRITABLE_CONTACT_FIELDS) {
    const next = input[field];
    if (next === undefined) continue;
    const internal = map[field];
    if (!internal) {
      unmapped.push(field);
      continue;
    }
    if ((current[field] ?? "") === next) continue;
    patch[internal] = next;
    changed.push(field);
  }
  return { patch, changed, unmapped };
}

/** Per-user write throttle: HubSpot is not a form backend. */
export const CONTACT_INFO_MAX_UPDATES_PER_DAY = 5;
