import { describe, expect, it } from "vitest";
import { planTeamImport, type ExistingTeamRow } from "./plan";
import type { TeamMemberImport } from "./parse";

function member(slug: string, overrides: Partial<TeamMemberImport> = {}): TeamMemberImport {
  return {
    slug,
    name: `Name ${slug}`,
    title: "Title",
    departments: [],
    photoUrl: null,
    whatIDo: null,
    background: null,
    whoIAm: null,
    ...overrides,
  };
}

describe("planTeamImport", () => {
  it("inserts members with no existing row", () => {
    const plan = planTeamImport([member("new-person")], []);
    expect(plan["new-person"]).toBe("insert");
  });

  it("updates existing unlocked rows", () => {
    const existing: ExistingTeamRow[] = [{ slug: "nick", locked: false }];
    const plan = planTeamImport([member("nick")], existing);
    expect(plan.nick).toBe("update");
  });

  it("skips locked rows (an admin hand-edited this member) rather than overwriting content", () => {
    const existing: ExistingTeamRow[] = [{ slug: "nick", locked: true }];
    const plan = planTeamImport([member("nick")], existing);
    expect(plan.nick).toBe("skip_locked");
  });

  it("plans each incoming member independently, keyed by slug", () => {
    const existing: ExistingTeamRow[] = [
      { slug: "a", locked: false },
      { slug: "b", locked: true },
    ];
    const plan = planTeamImport([member("a"), member("b"), member("c")], existing);
    expect(plan).toEqual({ a: "update", b: "skip_locked", c: "insert" });
  });

  it("ignores existing rows that are no longer on the site (no departed-member handling)", () => {
    const existing: ExistingTeamRow[] = [{ slug: "gone", locked: false }];
    const plan = planTeamImport([member("still-here")], existing);
    expect(plan).toEqual({ "still-here": "insert" });
    expect(plan.gone).toBeUndefined();
  });
});
