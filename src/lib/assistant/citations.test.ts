import { describe, expect, it } from "vitest";
import { isNotInHandbook, parseCitations, stripSourcesLine } from "./citations";
import { NOT_IN_HANDBOOK_PHRASE } from "./prompt";
import type { HandbookSection } from "@/db/schema";

const sections: HandbookSection[] = [
  { id: "§1.2", heading: "Your team", text: "Your Book Production Manager coordinates every stage of your project.", tokenEstimate: 12 },
  { id: "§4.1", heading: "Interior design proofs", text: "You'll receive a PDF proof to review before it goes to print.", tokenEstimate: 12 },
];

describe("stripSourcesLine", () => {
  it("removes a trailing Sources line and reports it was present", () => {
    const { text, hadSourcesLine } = stripSourcesLine("Here is your answer.\n\nSources: §1.2, §4.1");
    expect(text).toBe("Here is your answer.");
    expect(hadSourcesLine).toBe(true);
  });

  it("leaves text without a Sources line untouched", () => {
    const { text, hadSourcesLine } = stripSourcesLine("Just an answer, no sources.");
    expect(text).toBe("Just an answer, no sources.");
    expect(hadSourcesLine).toBe(false);
  });

  it("only matches a Sources line anchored at the end of the text", () => {
    const { text, hadSourcesLine } = stripSourcesLine("Sources: is a word I use here.\nBut this is the real answer.");
    expect(hadSourcesLine).toBe(false);
    expect(text).toBe("Sources: is a word I use here.\nBut this is the real answer.");
  });
});

describe("parseCitations", () => {
  it("resolves cited section ids and strips the Sources line", () => {
    const result = parseCitations(
      "Your BPM handles day-to-day coordination.\n\nSources: §1.2",
      sections,
    );
    expect(result.answer).toBe("Your BPM handles day-to-day coordination.");
    expect(result.citations).toEqual([
      { sectionId: "§1.2", heading: "Your team", quote: sections[0].text },
    ]);
    expect(result.notInHandbook).toBe(false);
  });

  it("resolves multiple citations in order and dedupes repeats", () => {
    const result = parseCitations("Two things happen.\n\nSources: §1.2, §4.1, §1.2", sections);
    expect(result.citations.map((c) => c.sectionId)).toEqual(["§1.2", "§4.1"]);
  });

  it("silently drops unknown section ids instead of throwing", () => {
    const result = parseCitations("An answer.\n\nSources: §9.9", sections);
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe("An answer.");
  });

  it("returns no citations when there is no Sources line", () => {
    const result = parseCitations("A plain answer with nothing cited.", sections);
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe("A plain answer with nothing cited.");
  });

  it("flags the refusal phrase as notInHandbook", () => {
    const result = parseCitations(`${NOT_IN_HANDBOOK_PHRASE}, so please ask your main contact.`, sections);
    expect(result.notInHandbook).toBe(true);
    expect(result.citations).toEqual([]);
  });
});

describe("isNotInHandbook", () => {
  it("is case-insensitive", () => {
    expect(isNotInHandbook(NOT_IN_HANDBOOK_PHRASE.toUpperCase())).toBe(true);
  });
  it("is false for ordinary answers", () => {
    expect(isNotInHandbook("Here's how proofing works.")).toBe(false);
  });
});
