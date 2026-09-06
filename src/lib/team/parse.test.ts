import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nameKey, parseTeamPage, stripTags } from "./parse";

const fixture = readFileSync(join(__dirname, "__fixtures__/ourteam-sample.html"), "utf8");

describe("parseTeamPage", () => {
  it("extracts name, title, departments, photo and the three bio paragraphs", () => {
    const members = parseTeamPage(fixture);
    expect(members.length).toBe(2);
    const nick = members[0];
    expect(nick.name).toBe("Dr. Nick Courtright");
    expect(nick.title).toBe("Founder & CEO");
    expect(nick.departments).toContain("leadership team");
    expect(nick.photoUrl).toMatch(/^https:\/\/atmospherepress\.com\/wp-content\/uploads\//);
    expect(nick.whatIDo).toMatch(/^As the Founder and CEO of Atmosphere Press/);
    expect(nick.background).toMatch(/author of 4 books/);
    expect(nick.whoIAm).toMatch(/Cleveland/);
    expect(members[1].name).toBe("Dr. Kyle McCord");
    expect(members[1].slug).toBe("dr.-kyle-mccord");
  });
  it("picks the largest image from srcset", () => {
    const [, kyle] = parseTeamPage(fixture);
    expect(kyle.photoUrl).toMatch(/\/3\.jpg$/);
  });
});

describe("helpers", () => {
  it("strips tags and decodes entities", () => {
    expect(stripTags("<p><b>Founder &amp; CEO</b> &#8217;s</p>")).toBe("Founder & CEO ’s");
  });
  it("normalises names for owner matching", () => {
    expect(nameKey("Dr. Kyle McCord")).toBe("kyle mccord");
    expect(nameKey("Nick  Courtright, PhD")).toBe("nick courtright");
  });
});
