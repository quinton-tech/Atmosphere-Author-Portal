import { describe, expect, it } from "vitest";
import { buildTeam, buildTimeline, friendly, parseDate } from "./timeline";
import { pickPortalProperties, resolveInternalNames } from "./properties";

describe("resolveInternalNames", () => {
  const schema = [
    { name: "pipeline_stage", label: "Pipeline Stage" },
    { name: "de", label: "DE" },
    { name: "de_assigned", label: "DE assigned" }, // case differs from our label
    { name: "pr_status", label: "Pr status" },
    { name: "publication_date_claire", label: "Publication Date (Claire-only)" },
  ];
  it("matches by exact and normalised label, honours overrides, reports unresolved", () => {
    const { map, unresolved } = resolveInternalNames(schema, { phone: "phone_number_custom" });
    expect(map.pipelineStage).toBe("pipeline_stage");
    expect(map.developmentalEditorAssigned).toBe("de_assigned");
    expect(map.publicationDate).toBe("publication_date_claire");
    expect(map.phone).toBe("phone_number_custom");
    expect(unresolved).toContain("coverDesigner");
    expect(unresolved).not.toContain("pipelineStage");
  });
  it("picks only mapped properties, re-keyed", () => {
    const { map } = resolveInternalNames(schema);
    const picked = pickPortalProperties({ pipeline_stage: "de", de: "Sam", secret: "x" }, map);
    expect(picked).toEqual({ pipelineStage: "de", developmentalEditor: "Sam" });
  });
});

describe("friendly / parseDate", () => {
  it("uses configured labels, else prettifies", () => {
    expect(friendly("developmentalEditorStatus", "in_progress", { developmentalEditorStatus: { in_progress: "Editing underway" } })).toBe("Editing underway");
    expect(friendly("developmentalEditorStatus", "awaiting_author_review", {})).toBe("Awaiting author review");
    expect(friendly("x", "", {})).toBeNull();
  });
  it("parses epoch ms and ISO", () => {
    expect(parseDate("1735689600000")?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(parseDate("2025-03-01")?.getUTCMonth()).toBe(2);
    expect(parseDate("nope")).toBeNull();
  });
});

describe("timeline + team", () => {
  const props = {
    initiationDate: "2025-01-01",
    package: "premium",
    developmentalEditor: "Sam Lee",
    developmentalEditorAssigned: "2025-02-01",
    developmentalEditorStatus: "complete",
    coverDesigner: "Ana Ruiz",
    coverDesignerAssigned: "2025-04-01",
    interiorDesigner: "Kai",
    publicationDate: "2026-01-15",
    pipelineStage: "cover",
  };
  const stages = [{ key: "cover_design", label: "Cover design" }];
  const now = new Date("2025-05-01T00:00:00Z");

  it("orders events, marks future, inserts current stage at now", () => {
    const t = buildTimeline(props, stages, "cover_design", {}, now);
    expect(t.map((e) => e.id)).toEqual(["initiation", "developmentalEditorAssigned", "coverDesignerAssigned", "current-stage", "publication"]);
    expect(t.find((e) => e.id === "publication")?.isFuture).toBe(true);
    expect(t.find((e) => e.id === "current-stage")?.title).toBe("Now: Cover design");
    expect(t.find((e) => e.id === "developmentalEditorAssigned")?.detail).toBe("Sam Lee · Complete");
  });
  it("builds the team from person properties only", () => {
    const team = buildTeam(props, {});
    expect(team.map((m) => m.role)).toEqual(["Developmental Editor", "Cover Designer", "Interior Designer"]);
    expect(team[2].assignedAt).toBeNull();
  });
});
