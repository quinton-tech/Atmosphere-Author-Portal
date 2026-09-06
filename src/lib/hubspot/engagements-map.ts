import { stripTags } from "@/lib/team/parse";

/**
 * Pure mapping/filtering for HubSpot Engagement Emails -> "Messages from your team" records. No
 * network, no "server-only", no env access — kept separate from `./engagements.ts` (which has all
 * three, transitively, via `@/lib/env`) so these functions can be unit tested directly. See the
 * same split rationale as `./plan.ts` vs `./sync.ts` (`sync.test.ts` has the full explanation).
 */

/** The raw HubSpot email properties this module requests/consumes. */
export const EMAIL_PROPERTIES = [
  "hs_email_subject",
  "hs_email_text",
  "hs_email_html",
  "hs_email_direction",
  "hs_email_status",
  "hs_timestamp",
  "hs_email_from_email",
  "hs_email_from_firstname",
  "hs_email_from_lastname",
  "hs_email_to_email",
  "hs_email_cc_email",
  "hs_email_sender_email",
  "hs_email_headers",
] as const;

export type RawHubSpotEmail = {
  id: string;
  properties: Partial<Record<(typeof EMAIL_PROPERTIES)[number], string | null>>;
};

export type ContactEmailRecord = {
  hubspotEmailId: string;
  direction: "sent" | "received";
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  sentAt: Date;
  snippet: string;
  bodyText: string | null;
};

const SNIPPET_LENGTH = 300;
const BODY_TEXT_MAX = 20_000;
/** Statuses (case-insensitive) that mean the email actually went out or came in, as opposed to a
 *  draft, a scheduled-but-not-sent email, or a failed send. */
const LOGGED_STATUSES = new Set(["SENT", "RECEIVED", "INCOMING", "FORWARDED"]);

/** HubSpot joins multi-recipient properties with ";" (sometimes "," in practice). */
function splitAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True if `authorEmail` appears anywhere in from/to/cc, case-insensitively. */
export function isAuthorParticipant(props: RawHubSpotEmail["properties"], authorEmail: string): boolean {
  if (!authorEmail) return false;
  const addresses = [
    ...splitAddresses(props.hs_email_from_email),
    ...splitAddresses(props.hs_email_to_email),
    ...splitAddresses(props.hs_email_cc_email),
  ];
  return addresses.some((a) => sameAddress(a, authorEmail));
}

/** "received" (author replied) if the author's address is the sender; "sent" (from the team)
 *  otherwise. */
export function mapDirection(props: RawHubSpotEmail["properties"], authorEmail: string): "sent" | "received" {
  const fromAddresses = splitAddresses(props.hs_email_from_email);
  return fromAddresses.some((a) => sameAddress(a, authorEmail)) ? "received" : "sent";
}

/** SENT / RECEIVED / INCOMING / FORWARDED only — never DRAFT, SCHEDULED, FAILED, BOUNCED. */
export function isLoggedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return LOGGED_STATUSES.has(status.toUpperCase());
}

function fromName(props: RawHubSpotEmail["properties"]): string | null {
  const name = [props.hs_email_from_firstname, props.hs_email_from_lastname].filter(Boolean).join(" ").trim();
  return name || null;
}

function firstAddress(value: string | null | undefined): string | null {
  return splitAddresses(value)[0] ?? null;
}

function plainTextBody(props: RawHubSpotEmail["properties"]): string {
  const text = props.hs_email_text?.trim();
  if (text) return text;
  const html = props.hs_email_html;
  return html ? stripTags(html) : "";
}

/**
 * Pure: turn one raw HubSpot email object into a `ContactEmailRecord`, or `null` if it should be
 * dropped (author isn't a participant, or it isn't an actually-sent/received email). Never returns
 * anything for notes/calls/tasks/meetings — this only ever sees `emails` objects to begin with.
 */
export function mapContactEmail(raw: RawHubSpotEmail, authorEmail: string): ContactEmailRecord | null {
  const { properties: props } = raw;
  if (!isLoggedStatus(props.hs_email_status)) return null;
  if (!isAuthorParticipant(props, authorEmail)) return null;

  const bodyText = plainTextBody(props);
  const toAddresses = [...new Set([...splitAddresses(props.hs_email_to_email), ...splitAddresses(props.hs_email_cc_email)])];
  const timestamp = props.hs_timestamp ? Number(props.hs_timestamp) : NaN;
  const sentAt = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(0);

  return {
    hubspotEmailId: raw.id,
    direction: mapDirection(props, authorEmail),
    subject: props.hs_email_subject?.trim() || null,
    fromName: fromName(props),
    fromEmail: firstAddress(props.hs_email_from_email) ?? firstAddress(props.hs_email_sender_email),
    toEmails: toAddresses,
    sentAt,
    snippet: bodyText.slice(0, SNIPPET_LENGTH),
    bodyText: bodyText ? bodyText.slice(0, BODY_TEXT_MAX) : null,
  };
}

/** Cap applied after mapping+filtering: the 200 most recent (by `sentAt`, newest first). */
export const MAX_MESSAGES = 200;

/** Pure: map + filter a batch of raw emails, newest first, capped at `MAX_MESSAGES`. */
export function mapAndFilterEmails(raw: RawHubSpotEmail[], authorEmail: string): ContactEmailRecord[] {
  return raw
    .map((r) => mapContactEmail(r, authorEmail))
    .filter((r): r is ContactEmailRecord => r !== null)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, MAX_MESSAGES);
}
