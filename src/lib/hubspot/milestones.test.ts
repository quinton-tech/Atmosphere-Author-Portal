import { describe, expect, it } from "vitest";
import { evaluateMilestones } from "./milestones";
import type { StageMilestone } from "@/db/schema";

const stages = [
  { key: "editorial", label: "Editorial", sortOrder: 1 },
  { key: "publicity", label: "Publicity", sortOrder: 2 },
];

function milestone(
  over: Partial<StageMilestone> & { linkLabel?: string | null } & Pick<StageMilestone, "id" | "stageKey" | "label" | "propertyName">,
): StageMilestone & { linkLabel?: string | null } {
  return {
    description: "",
    kind: "status",
    doneValues: [],
    hiddenValues: [],
    inProgressValues: null,
    linkProperty: null,
    dateProperty: null,
    venueProperty: null,
    includeRule: null,
    sortOrder: 0,
    enabled: true,
    updatedAt: new Date(),
    ...over,
  } as StageMilestone & { linkLabel?: string | null };
}

describe("evaluateMilestones", () => {
  it("includes a milestone with a null rule for everyone", () => {
    const m = milestone({ id: "m1", stageKey: "editorial", label: "Cold read", propertyName: "cold_read_status", doneValues: ["Completed"] });
    const views = evaluateMilestones({ "hs:cold_read_status": null }, [m], stages, {});
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe("pending");
  });

  it("excludes a milestone gated by package when the package doesn't match and there's no value", () => {
    const m = milestone({
      id: "m1",
      stageKey: "editorial",
      label: "Cold read",
      propertyName: "cold_read_status",
      doneValues: ["Completed"],
      includeRule: { packages: ["Flagship"] },
    });
    const views = evaluateMilestones({ package: "Essential", "hs:cold_read_status": null }, [m], stages, {});
    expect(views).toHaveLength(0);
  });

  it("includes when the package matches (case-insensitive)", () => {
    const m = milestone({
      id: "m1",
      stageKey: "editorial",
      label: "Cold read",
      propertyName: "cold_read_status",
      doneValues: ["Completed"],
      includeRule: { packages: ["flagship"] },
    });
    const views = evaluateMilestones({ package: "Flagship" }, [m], stages, {});
    expect(views).toHaveLength(1);
  });

  it("includes when a Service Add-on is present, splitting the ';'-joined multi-select", () => {
    const m = milestone({
      id: "m1",
      stageKey: "editorial",
      label: "Cold read",
      propertyName: "cold_read_status",
      doneValues: ["Completed"],
      includeRule: { addOns: ["Cold Reading"] },
    });
    const views = evaluateMilestones({ serviceAddOns: "Hardcover;Cold Reading" }, [m], stages, {});
    expect(views).toHaveLength(1);
  });

  it("data wins: a non-hidden value shows the milestone even when the rule doesn't match", () => {
    const m = milestone({
      id: "m1",
      stageKey: "editorial",
      label: "Cold read",
      propertyName: "cold_read_status",
      doneValues: ["Completed"],
      includeRule: { packages: ["Flagship"] },
    });
    const views = evaluateMilestones({ package: "Essential", "hs:cold_read_status": "Needed" }, [m], stages, {});
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe("in_progress");
  });

  it("hides a milestone entirely when the value is a hidden value", () => {
    const m = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "Premier review",
      propertyName: "premier_review",
      doneValues: ["Kirkus rev sent to author"],
      hiddenValues: ["NOT publishing"],
    });
    const views = evaluateMilestones({ "hs:premier_review": "NOT publishing" }, [m], stages, {});
    expect(views).toHaveLength(0);
  });

  it("status kind: done/in_progress/pending", () => {
    const m = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "NetGalley",
      propertyName: "netgalley",
      doneValues: ["Archived", "Author Received"],
    });
    expect(evaluateMilestones({ "hs:netgalley": "Archived" }, [m], stages, {})[0].state).toBe("done");
    expect(evaluateMilestones({ "hs:netgalley": "Active" }, [m], stages, {})[0].state).toBe("in_progress");
    expect(evaluateMilestones({ "hs:netgalley": "" }, [m], stages, {})[0].state).toBe("pending");
  });

  it("respects an explicit inProgressValues list", () => {
    const m = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "Boost",
      propertyName: "boost_status",
      doneValues: ["Active", "Archived"],
      inProgressValues: ["Interested", "Sent Meeting Link", "Scheduled", "Sent Contract", "Signed"],
      hiddenValues: ["Declined"],
    });
    const views = evaluateMilestones({ "hs:boost_status": "Interested" }, [m], stages, {});
    expect(views[0].state).toBe("in_progress");
  });

  it("date kind: done when in the past, scheduled when in the future, pending when empty", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const m = milestone({ id: "m1", stageKey: "publicity", label: "Publicity complete", propertyName: "publicity_complete", kind: "date" });
    expect(evaluateMilestones({ "hs:publicity_complete": "2025-01-01" }, [m], stages, {}, now)[0].state).toBe("done");
    expect(evaluateMilestones({ "hs:publicity_complete": "2027-01-01" }, [m], stages, {}, now)[0].state).toBe("scheduled");
    expect(evaluateMilestones({ "hs:publicity_complete": "" }, [m], stages, {}, now)[0].state).toBe("pending");
  });

  it("flag kind: true/yes means done, else pending", () => {
    const m = milestone({ id: "m1", stageKey: "publicity", label: "Some flag", propertyName: "flag_prop", kind: "flag" });
    expect(evaluateMilestones({ "hs:flag_prop": "true" }, [m], stages, {})[0].state).toBe("done");
    expect(evaluateMilestones({ "hs:flag_prop": "yes" }, [m], stages, {})[0].state).toBe("done");
    expect(evaluateMilestones({ "hs:flag_prop": "no" }, [m], stages, {})[0].state).toBe("pending");
  });

  it("appends the venue to the label and uses friendly() labels/dates in the detail", () => {
    const m = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "Premier review",
      propertyName: "premier_review",
      doneValues: ["Kirkus rev sent to author"],
      venueProperty: "premier_review_venue",
      dateProperty: "premier_review_sent_date",
      linkProperty: "kirkus_link",
    });
    const props = {
      "hs:premier_review": "Kirkus rev sent to author",
      "hs:premier_review_venue": "Kirkus",
      "hs:premier_review_sent_date": "1748779200000", // 2025-06-01T12:00:00Z — midday UTC, immune to local-TZ day drift
      "hs:kirkus_link": "https://kirkusreviews.com/abc",
    };
    const labels = { premier_review: { "kirkus rev sent to author": "Sent to author" } };
    const [view] = evaluateMilestones(props, [m], stages, labels);
    expect(view.label).toBe("Premier review · Kirkus");
    expect(view.detail).toBe("Sent to author · June 1, 2025");
    expect(view.href).toBe("https://kirkusreviews.com/abc");
    expect(view.state).toBe("done");
    expect(view.linkLabel).toBe("View"); // no linkLabel configured on the row -> generic fallback
  });

  it("does not produce an href for a non-URL link value", () => {
    const m = milestone({ id: "m1", stageKey: "publicity", label: "Goodreads", propertyName: "goodreads_listing", linkProperty: "goodreads_link", doneValues: ["Completed"] });
    const views = evaluateMilestones({ "hs:goodreads_listing": "Completed", "hs:goodreads_link": "n/a" }, [m], stages, {});
    expect(views[0].href).toBeNull();
    expect(views[0].linkLabel).toBeNull();
  });

  it("substitutes {venue} into a configured link label, using the friendly-labelled venue", () => {
    const m = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "Premier review",
      propertyName: "premier_review",
      doneValues: ["Kirkus rev sent to author"],
      venueProperty: "premier_review_venue",
      linkProperty: "kirkus_link",
      linkLabel: "Read your {venue} review",
    });
    const props = {
      "hs:premier_review": "Kirkus rev sent to author",
      "hs:premier_review_venue": "kirkus",
      "hs:kirkus_link": "https://kirkusreviews.com/abc",
    };
    const labels = { premier_review_venue: { kirkus: "Kirkus" } };
    const [view] = evaluateMilestones(props, [m], stages, labels);
    expect(view.linkLabel).toBe("Read your Kirkus review");
  });

  it("keeps a configured link label without a {venue} placeholder as-is, and returns null when there is no href even if a label is configured", () => {
    const withHref = milestone({
      id: "m1",
      stageKey: "publicity",
      label: "NetGalley",
      propertyName: "netgalley",
      linkProperty: "netgalley_link",
      doneValues: ["Archived"],
      linkLabel: "See your listing",
    });
    const viewWithHref = evaluateMilestones(
      { "hs:netgalley": "Archived", "hs:netgalley_link": "https://netgalley.com/x" },
      [withHref],
      stages,
      {},
    )[0];
    expect(viewWithHref.linkLabel).toBe("See your listing");

    const noHref = milestone({
      id: "m2",
      stageKey: "publicity",
      label: "NetGalley",
      propertyName: "netgalley2",
      doneValues: ["Archived"],
      linkLabel: "See your listing",
    });
    const viewNoHref = evaluateMilestones({ "hs:netgalley2": "Archived" }, [noHref], stages, {})[0];
    expect(viewNoHref.href).toBeNull();
    expect(viewNoHref.linkLabel).toBeNull();
  });

  it("sorts by stage sortOrder then milestone sortOrder", () => {
    const m1 = milestone({ id: "m1", stageKey: "publicity", label: "B", propertyName: "p1", sortOrder: 1 });
    const m2 = milestone({ id: "m2", stageKey: "editorial", label: "A", propertyName: "p2", sortOrder: 5 });
    const m3 = milestone({ id: "m3", stageKey: "publicity", label: "C", propertyName: "p3", sortOrder: 0 });
    const views = evaluateMilestones({ "hs:p1": "x", "hs:p2": "x", "hs:p3": "x" }, [m1, m2, m3], stages, {});
    expect(views.map((v) => v.id)).toEqual(["m2", "m3", "m1"]);
  });

  it("skips a milestone whose stage isn't in the provided stage list", () => {
    const m = milestone({ id: "m1", stageKey: "unknown_stage", label: "Orphan", propertyName: "p1" });
    const views = evaluateMilestones({ "hs:p1": "x" }, [m], stages, {});
    expect(views).toHaveLength(0);
  });

  it("skips a disabled milestone", () => {
    const m = milestone({ id: "m1", stageKey: "editorial", label: "Off", propertyName: "p1", enabled: false });
    const views = evaluateMilestones({ "hs:p1": "x" }, [m], stages, {});
    expect(views).toHaveLength(0);
  });
});
