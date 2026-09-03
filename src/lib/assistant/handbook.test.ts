import { describe, expect, it } from "vitest";
import { estimateTokens, splitIntoSections } from "./handbook-text";

describe("estimateTokens", () => {
  it("estimates roughly chars/4", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("splitIntoSections", () => {
  it("splits on numbered top-level and subheadings, assigning stable §ids", () => {
    const text = [
      "1 Getting started",
      "",
      "Welcome to Atmosphere Press.",
      "",
      "1.2 Your team",
      "",
      "Your Book Production Manager will reach out first.",
      "",
      "6.1 Interior design proofs",
      "",
      "You will receive a PDF proof before it goes to print.",
    ].join("\n");

    const sections = splitIntoSections(text);
    expect(sections.map((s) => s.id)).toEqual(["§1", "§1.2", "§6.1"]);
    expect(sections[0].heading).toBe("Getting started");
    expect(sections[1]).toMatchObject({ heading: "Your team", text: "Your Book Production Manager will reach out first." });
    expect(sections[2]).toMatchObject({ heading: "Interior design proofs" });
  });

  it("does not treat an inline sentence starting with a number as a heading", () => {
    const text = [
      "Some intro text.",
      "",
      "3 things happen after you submit your manuscript, and none of them are instant.",
      "",
      "More text follows on the same topic.",
    ].join("\n");

    const sections = splitIntoSections(text);
    // No standalone numbered heading detected (the "heading" line is long / not title-cased
    // the way a real heading would be) — falls back to word-chunking the whole thing.
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].id).toBe("§1");
  });

  it("falls back to ALL-CAPS short lines as headings when there is no numbering", () => {
    const text = ["INTRODUCTION", "", "Welcome to the handbook.", "", "YOUR TEAM", "", "Meet the people on your project."].join("\n");
    const sections = splitIntoSections(text);
    expect(sections.map((s) => s.heading)).toEqual(["Introduction", "Your Team"]);
  });

  it("falls back to ~1200-word chunks when no headings are detected at all", () => {
    const text = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ");
    const sections = splitIntoSections(text);
    expect(sections.length).toBe(3); // 3000 words / 1200 per chunk, rounded up
    expect(sections[0].id).toBe("§1");
    expect(sections.every((s) => s.tokenEstimate > 0)).toBe(true);
  });

  it("guarantees unique ids even if the same heading number repeats", () => {
    const text = ["1 Intro", "", "First.", "", "1 Intro again", "", "Second."].join("\n");
    const sections = splitIntoSections(text);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
