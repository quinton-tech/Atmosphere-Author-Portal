import { describe, expect, it } from "vitest";
import {
  isAuthorParticipant,
  isLoggedStatus,
  mapAndFilterEmails,
  mapContactEmail,
  mapDirection,
  MAX_MESSAGES,
  type RawHubSpotEmail,
} from "./engagements-map";

const AUTHOR = "author@example.com";

function email(overrides: Partial<RawHubSpotEmail["properties"]> = {}, id = "1"): RawHubSpotEmail {
  return {
    id,
    properties: {
      hs_email_subject: "Your manuscript",
      hs_email_text: "Hi there, checking in on your manuscript.",
      hs_email_html: null,
      hs_email_direction: "EMAIL",
      hs_email_status: "SENT",
      hs_timestamp: "1700000000000",
      hs_email_from_email: "bpm@atmospherepress.com",
      hs_email_from_firstname: "Pat",
      hs_email_from_lastname: "BPM",
      hs_email_to_email: AUTHOR,
      hs_email_cc_email: null,
      hs_email_sender_email: null,
      hs_email_headers: null,
      ...overrides,
    },
  };
}

describe("isAuthorParticipant", () => {
  it("matches when the author is in to", () => {
    expect(isAuthorParticipant(email().properties, AUTHOR)).toBe(true);
  });

  it("matches when the author is in cc, case-insensitively", () => {
    const props = email({ hs_email_to_email: "someoneelse@atmospherepress.com", hs_email_cc_email: "Author@Example.com" }).properties;
    expect(isAuthorParticipant(props, AUTHOR)).toBe(true);
  });

  it("matches when the author is the sender", () => {
    const props = email({ hs_email_from_email: AUTHOR, hs_email_to_email: "bpm@atmospherepress.com" }).properties;
    expect(isAuthorParticipant(props, AUTHOR)).toBe(true);
  });

  it("does not match an internal-only email the author isn't on", () => {
    const props = email({ hs_email_to_email: "someoneelse@atmospherepress.com" }).properties;
    expect(isAuthorParticipant(props, AUTHOR)).toBe(false);
  });
});

describe("mapDirection", () => {
  it("is 'sent' when the team is the sender", () => {
    expect(mapDirection(email().properties, AUTHOR)).toBe("sent");
  });

  it("is 'received' when the author is the sender (a reply)", () => {
    const props = email({ hs_email_from_email: AUTHOR }).properties;
    expect(mapDirection(props, AUTHOR)).toBe("received");
  });
});

describe("isLoggedStatus", () => {
  it("accepts SENT and RECEIVED (case-insensitive)", () => {
    expect(isLoggedStatus("SENT")).toBe(true);
    expect(isLoggedStatus("received")).toBe(true);
    expect(isLoggedStatus("Incoming")).toBe(true);
  });

  it("rejects drafts, scheduled, failed, and bounced", () => {
    expect(isLoggedStatus("DRAFT")).toBe(false);
    expect(isLoggedStatus("SCHEDULED")).toBe(false);
    expect(isLoggedStatus("FAILED")).toBe(false);
    expect(isLoggedStatus("BOUNCED")).toBe(false);
    expect(isLoggedStatus(null)).toBe(false);
    expect(isLoggedStatus(undefined)).toBe(false);
  });
});

describe("mapContactEmail", () => {
  it("strips HTML to plain text when there's no hs_email_text", () => {
    const raw = email({
      hs_email_text: null,
      hs_email_html: "<p>Hello &amp; welcome,</p><p>See <b>attached</b>.</p>",
    });
    const mapped = mapContactEmail(raw, AUTHOR);
    expect(mapped?.bodyText).toBe("Hello & welcome, See attached .");
  });

  it("prefers hs_email_text over hs_email_html when both are present", () => {
    const raw = email({ hs_email_text: "Plain version.", hs_email_html: "<p>HTML version.</p>" });
    const mapped = mapContactEmail(raw, AUTHOR);
    expect(mapped?.bodyText).toBe("Plain version.");
  });

  it("caps the snippet at 300 chars and body at 20k chars", () => {
    const long = "x".repeat(25_000);
    const raw = email({ hs_email_text: long });
    const mapped = mapContactEmail(raw, AUTHOR);
    expect(mapped?.snippet.length).toBe(300);
    expect(mapped?.bodyText?.length).toBe(20_000);
  });

  it("returns null for a draft/unsent email even if the author is on it", () => {
    const raw = email({ hs_email_status: "DRAFT" });
    expect(mapContactEmail(raw, AUTHOR)).toBeNull();
  });

  it("returns null when the author never participated (internal-only email)", () => {
    const raw = email({ hs_email_to_email: "someoneelse@atmospherepress.com", hs_email_cc_email: null });
    expect(mapContactEmail(raw, AUTHOR)).toBeNull();
  });

  it("never maps a non-email engagement shape into something author-visible", () => {
    // Notes/calls/tasks/meetings don't have these email-specific properties at all; a record with
    // none of them should simply fail the status/participation checks rather than being coerced
    // into a message.
    const raw: RawHubSpotEmail = { id: "note-1", properties: {} };
    expect(mapContactEmail(raw, AUTHOR)).toBeNull();
  });
});

describe("mapAndFilterEmails", () => {
  it("sorts newest first and caps at MAX_MESSAGES", () => {
    const raw: RawHubSpotEmail[] = Array.from({ length: MAX_MESSAGES + 50 }, (_, i) =>
      email({ hs_timestamp: String(1_000_000 + i) }, String(i)),
    );
    const mapped = mapAndFilterEmails(raw, AUTHOR);
    expect(mapped).toHaveLength(MAX_MESSAGES);
    // newest (highest timestamp) first
    expect(mapped[0].hubspotEmailId).toBe(String(raw.length - 1));
    for (let i = 1; i < mapped.length; i++) {
      expect(mapped[i - 1].sentAt.getTime()).toBeGreaterThanOrEqual(mapped[i].sentAt.getTime());
    }
  });

  it("drops emails the author didn't participate in and keeps the rest", () => {
    const raw: RawHubSpotEmail[] = [
      email({ hs_email_to_email: "someoneelse@atmospherepress.com", hs_email_cc_email: null }, "internal"),
      email({}, "visible"),
    ];
    const mapped = mapAndFilterEmails(raw, AUTHOR);
    expect(mapped.map((m) => m.hubspotEmailId)).toEqual(["visible"]);
  });
});
