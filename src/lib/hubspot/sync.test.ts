import { describe, expect, it } from "vitest";
// Import the pure planning step from "./plan", not "./sync": sync.ts (the orchestration layer)
// imports "server-only" transitively via "@/db" and "@/lib/env", which throws outside a bundler
// that resolves the "react-server" export condition — including under vitest's default Node/Vite
// runner. "./plan" has zero dependency on either, by design, so it can be imported directly here.
import { fetchAndPlanKeysetPage, fetchAndPlanPage, planSync } from "./plan";
import type { HubSpotContactSummary, HubSpotProject, HubSpotReader } from "./client";

function project(over: Partial<HubSpotProject> & { id: string }): HubSpotProject {
  return { properties: {}, updatedAt: new Date("2025-01-01T00:00:00Z"), contactIds: [], ...over };
}

function contact(over: Partial<HubSpotContactSummary> & { id: string }): HubSpotContactSummary {
  return {
    email: null,
    firstname: null,
    lastname: null,
    phone: null,
    street: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    ...over,
  };
}

describe("planSync", () => {
  const stages = [{ key: "cover_design", hubspotValues: ["Cover"] }];
  const propertyMap = { pipelineStage: "pipeline_stage_raw", phone: "phone" };

  it("builds users/books/caches, dedupes authors across books, and reports unmatched projects", () => {
    const projects: HubSpotProject[] = [
      project({ id: "p1", contactIds: ["c1"], properties: { pipeline_stage_raw: "Cover", name: "Book One" }, updatedAt: new Date("2025-02-01T00:00:00Z") }),
      project({ id: "p2", contactIds: ["c1"], properties: { pipeline_stage_raw: "Cover", name: "Book Two" }, updatedAt: new Date("2025-02-02T00:00:00Z") }),
      project({ id: "p3", contactIds: ["c2"], properties: { name: "Book Three" } }), // c2 has no email -> unmatched
      project({ id: "p4", contactIds: [], properties: { name: "Book Four" } }), // no associated contact at all
    ];
    const contacts = new Map<string, HubSpotContactSummary>([
      ["c1", contact({ id: "c1", email: "Author@Example.com", firstname: "Ann", lastname: "Author" })],
      ["c2", contact({ id: "c2", email: null, firstname: "No", lastname: "Email" })],
    ]);

    const plan = planSync(projects, contacts, stages, propertyMap, { titleProperty: "name" });

    expect(plan.users).toEqual([
      {
        email: "author@example.com",
        hubspotContactId: "c1",
        name: "Ann Author",
        phone: null,
        street: null,
        city: null,
        region: null,
        postalCode: null,
        country: null,
      },
    ]);
    expect(plan.books.map((b) => b.hubspotProjectId)).toEqual(["p1", "p2"]);
    expect(plan.books.every((b) => b.authorEmail === "author@example.com")).toBe(true);
    expect(plan.caches.find((c) => c.hubspotProjectId === "p1")?.stageKey).toBe("cover_design");
    expect(plan.unmatchedProjectIds).toEqual(["p3", "p4"]);
  });

  it("falls back to Untitled for a blank title, and tracks distinct enum values seen", () => {
    const projects: HubSpotProject[] = [
      project({ id: "p1", contactIds: ["c1"], properties: { pipeline_stage_raw: "In Progress", name: "  " } }),
      project({ id: "p2", contactIds: ["c1"], properties: { pipeline_stage_raw: "In Progress" } }),
    ];
    const contacts = new Map<string, HubSpotContactSummary>([["c1", contact({ id: "c1", email: "a@b.com" })]]);

    const plan = planSync(projects, contacts, [], propertyMap, { titleProperty: "name" });

    expect(plan.books.map((b) => b.title)).toEqual(["Untitled", "Untitled"]);
    expect(plan.enumValuesSeen.pipelineStage).toEqual(["In Progress"]);
    expect(plan.users[0].name).toBeNull();
  });

  it("caches extraProperties (milestone-driving raw HubSpot properties) namespaced as hs:<name>", () => {
    const projects: HubSpotProject[] = [
      project({ id: "p1", contactIds: ["c1"], properties: { name: "Book One", cold_read_status: "Completed" } }),
    ];
    const contacts = new Map<string, HubSpotContactSummary>([["c1", contact({ id: "c1", email: "a@b.com" })]]);

    const plan = planSync(projects, contacts, [], {}, { titleProperty: "name", extraProperties: ["cold_read_status", "missing_property"] });

    const cache = plan.caches.find((c) => c.hubspotProjectId === "p1");
    expect(cache?.properties["hs:cold_read_status"]).toBe("Completed");
    expect(cache?.properties["hs:missing_property"]).toBeNull();
  });

  it("defaults the title property to \"name\" when not configured", () => {
    const projects: HubSpotProject[] = [project({ id: "p1", contactIds: ["c1"], properties: { name: "My Book" } })];
    const contacts = new Map<string, HubSpotContactSummary>([["c1", contact({ id: "c1", email: "a@b.com", firstname: "A" })]]);

    const plan = planSync(projects, contacts, [], {});

    expect(plan.books[0].title).toBe("My Book");
  });

  it("carries the Contact's canonical profile fields (phone/address) onto PlannedUser (review finding #1)", () => {
    const projects: HubSpotProject[] = [project({ id: "p1", contactIds: ["c1"], properties: { name: "My Book" } })];
    const contacts = new Map<string, HubSpotContactSummary>([
      [
        "c1",
        contact({
          id: "c1",
          email: "a@b.com",
          phone: "+1 555 0100",
          street: "1 Main St",
          city: "Austin",
          region: "TX",
          postalCode: "78701",
          country: "USA",
        }),
      ],
    ]);

    const plan = planSync(projects, contacts, [], {});

    expect(plan.users[0]).toMatchObject({
      phone: "+1 555 0100",
      street: "1 Main St",
      city: "Austin",
      region: "TX",
      postalCode: "78701",
      country: "USA",
    });
  });
});

describe("fetchAndPlanPage (fake HubSpotReader)", () => {
  it("drives one page of search + contact lookup through planSync without touching a DB", async () => {
    const seenContactLookups: string[][] = [];
    const fakeReader: HubSpotReader = {
      async getProjectSchema() {
        return { properties: [] };
      },
      async searchProjectsModifiedSince(since, after) {
        expect(since).toBeNull();
        expect(after).toBeUndefined();
        return {
          results: [
            project({ id: "p1", contactIds: ["c1"], properties: { name: "Book One", pipeline_stage_raw: "Cover" } }),
            project({ id: "p2", contactIds: [], properties: { name: "Book Two" } }),
          ],
          nextAfter: "page-2",
        };
      },
      async getProject() {
        return null;
      },
      async getContactsByIds(ids) {
        seenContactLookups.push(ids);
        return new Map<string, HubSpotContactSummary>([["c1", contact({ id: "c1", email: "a@b.com", firstname: "A", lastname: "B" })]]);
      },
      async getOwners() {
        return new Map<string, { name: string; email: string | null }>();
      },
      async getProjectsForContact() {
        return [];
      },
      async searchProjectsAfterId() {
        return { results: [], lastObjectId: null };
      },
    };

    const { plan, nextAfter } = await fetchAndPlanPage(fakeReader, null, undefined, {
      stages: [{ key: "cover_design", hubspotValues: ["Cover"] }],
      propertyMap: { pipelineStage: "pipeline_stage_raw" },
      titleProperty: "name",
    });

    expect(nextAfter).toBe("page-2");
    expect(seenContactLookups).toEqual([["c1"]]); // only the ids actually referenced by the page
    expect(plan.books).toHaveLength(1);
    expect(plan.users[0].email).toBe("a@b.com");
    expect(plan.unmatchedProjectIds).toEqual(["p2"]);
  });

  it("paginates: a second call with the returned cursor asks for the next page", async () => {
    const seenAfters: (string | undefined)[] = [];
    const fakeReader: HubSpotReader = {
      async getProjectSchema() {
        return { properties: [] };
      },
      async searchProjectsModifiedSince(_since, after) {
        seenAfters.push(after);
        if (!after) return { results: [project({ id: "p1", contactIds: [] })], nextAfter: "cursor-1" };
        return { results: [project({ id: "p2", contactIds: [] })], nextAfter: undefined };
      },
      async getProject() {
        return null;
      },
      async getContactsByIds() {
        return new Map();
      },
      async getOwners() {
        return new Map<string, { name: string; email: string | null }>();
      },
      async getProjectsForContact() {
        return [];
      },
      async searchProjectsAfterId() {
        return { results: [], lastObjectId: null };
      },
    };

    const config = { stages: [], propertyMap: {}, titleProperty: "name" };
    const first = await fetchAndPlanPage(fakeReader, null, undefined, config);
    expect(first.nextAfter).toBe("cursor-1");
    const second = await fetchAndPlanPage(fakeReader, null, first.nextAfter, config);
    expect(second.nextAfter).toBeUndefined();
    expect(seenAfters).toEqual([undefined, "cursor-1"]);
  });
});

describe("fetchAndPlanKeysetPage (review finding #4: HubSpot's 10,000-result search ceiling)", () => {
  /**
   * A fake reader backing a dataset bigger than HubSpot's 10,000-result search ceiling
   * (https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm). Every call is a
   * fresh, unpaginated (`after`-less) search filtered to ids greater than `lastObjectId`, exactly
   * like the real `HubSpotApiClient.searchProjectsAfterId` — so walking the whole dataset this way
   * never asks any single query to page past its own 10,000-result budget, however large the
   * dataset actually is.
   */
  function makeLargeDatasetReader(totalIds: number, pageSize = 100): { reader: HubSpotReader; calls: (string | null)[] } {
    const calls: (string | null)[] = [];
    const reader: HubSpotReader = {
      async getProjectSchema() {
        return { properties: [] };
      },
      async getProject() {
        return null;
      },
      async getContactsByIds() {
        return new Map();
      },
      async getOwners() {
        return new Map<string, { name: string; email: string | null }>();
      },
      async getProjectsForContact() {
        return [];
      },
      async searchProjectsModifiedSince() {
        throw new Error("not used by keyset pagination");
      },
      async searchProjectsAfterId(lastObjectId) {
        calls.push(lastObjectId);
        const afterId = lastObjectId ? Number(lastObjectId) : 0;
        const ids = Array.from({ length: totalIds }, (_, i) => i + 1).filter((id) => id > afterId).slice(0, pageSize);
        const results = ids.map((id) => project({ id: String(id), contactIds: [] }));
        return { results, lastObjectId: ids.length ? String(ids[ids.length - 1]) : lastObjectId };
      },
    };
    return { reader, calls };
  }

  it("restarts with the previous page's last id instead of paging with `after`, and terminates on an empty page", async () => {
    const totalIds = 10_250; // comfortably past the 10,000-result ceiling a single search would hit
    const { reader, calls } = makeLargeDatasetReader(totalIds);
    const config = { stages: [], propertyMap: {}, titleProperty: "name" };

    let lastObjectId: string | null = null;
    let pages = 0;
    let processed = 0;
    for (;;) {
      const { plan, lastObjectId: next } = await fetchAndPlanKeysetPage(reader, lastObjectId, null, config);
      pages++;
      processed += plan.books.length + plan.unmatchedProjectIds.length;
      lastObjectId = next;
      if (plan.books.length + plan.unmatchedProjectIds.length === 0) break;
      if (pages > totalIds) throw new Error("did not terminate"); // guard against an infinite loop bug
    }

    expect(processed).toBe(totalIds);
    expect(pages).toBe(Math.ceil(totalIds / 100) + 1); // +1 for the final empty page that ends the walk
    // Every call restarts a fresh search from the previous page's watermark — never an `after` cursor.
    expect(calls[0]).toBeNull();
    expect(calls[1]).toBe("100");
    // The final call (which finds nothing past the watermark and ends the walk) is invoked with the
    // watermark left by the last page of real data.
    expect(calls[calls.length - 1]).toBe(String(totalIds));
    expect(new Set(calls.slice(1)).size).toBe(calls.length - 1); // strictly increasing watermark, no repeats
  });

  it("passes `since` through unchanged so incremental sync's overflow fallback stays scoped by date", async () => {
    const seenSince: (Date | null | undefined)[] = [];
    const reader: HubSpotReader = {
      async getProjectSchema() {
        return { properties: [] };
      },
      async getProject() {
        return null;
      },
      async getContactsByIds() {
        return new Map();
      },
      async getOwners() {
        return new Map<string, { name: string; email: string | null }>();
      },
      async getProjectsForContact() {
        return [];
      },
      async searchProjectsModifiedSince() {
        throw new Error("not used by keyset pagination");
      },
      async searchProjectsAfterId(lastObjectId, since) {
        seenSince.push(since);
        return { results: [], lastObjectId };
      },
    };

    const since = new Date("2026-01-01T00:00:00Z");
    await fetchAndPlanKeysetPage(reader, "42", since, { stages: [], propertyMap: {}, titleProperty: "name" });
    expect(seenSince).toEqual([since]);
  });
});
