import { describe, expect, it } from "vitest";
import {
  buildDriveFileView,
  inferCategory,
  isThumbnailEligible,
  labelFromName,
  matchBookByTitle,
  normalizeTitle,
  titleFolderMatch,
} from "./files-view";
import type { DriveFile } from "./client";

function file(over: Partial<DriveFile> & { id: string; name: string }): DriveFile {
  return { mimeType: "application/octet-stream", size: null, modifiedTime: null, thumbnailLink: null, iconLink: null, isFolder: false, ...over };
}

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("The Orchard, at Dusk!")).toBe("the orchard at dusk");
  });
  it("collapses whitespace", () => {
    expect(normalizeTitle("  Multiple   Spaces  ")).toBe("multiple spaces");
  });
  it("returns empty string for empty/punctuation-only input", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle("!!!")).toBe("");
  });
});

describe("titleFolderMatch", () => {
  it("matches when the folder name contains the title", () => {
    expect(titleFolderMatch("The Orchard at Dusk - FINAL", "The Orchard at Dusk")).toBe(true);
  });
  it("matches when the title contains the folder name", () => {
    expect(titleFolderMatch("Orchard", "The Orchard at Dusk")).toBe(true);
  });
  it("is case- and punctuation-insensitive", () => {
    expect(titleFolderMatch("the-orchard-at-dusk", "The Orchard, at Dusk!")).toBe(true);
  });
  it("does not match unrelated names", () => {
    expect(titleFolderMatch("Cover Art", "The Orchard at Dusk")).toBe(false);
  });
  it("never matches when either side is empty after normalising", () => {
    expect(titleFolderMatch("!!!", "The Orchard at Dusk")).toBe(false);
    expect(titleFolderMatch("The Orchard at Dusk", "")).toBe(false);
  });
});

describe("matchBookByTitle", () => {
  const books = [
    { id: "b1", title: "The Orchard at Dusk" },
    { id: "b2", title: "Winter Ledger" },
  ];
  it("finds the matching book", () => {
    expect(matchBookByTitle("The Orchard at Dusk", books)?.id).toBe("b1");
  });
  it("returns null when nothing matches", () => {
    expect(matchBookByTitle("Miscellaneous", books)).toBeNull();
  });
});

describe("inferCategory", () => {
  it("recognizes cover files", () => {
    expect(inferCategory("Final Cover.jpg")).toBe("Cover");
  });
  it("recognizes blurb/synopsis files", () => {
    expect(inferCategory("Blurb.pdf")).toBe("Blurb");
    expect(inferCategory("Synopsis.docx")).toBe("Blurb");
  });
  it("treats a back-cover blurb as a Blurb, not a Cover", () => {
    expect(inferCategory("Back-Cover Blurb.pdf")).toBe("Blurb");
    expect(inferCategory("Back cover text.docx")).toBe("Blurb");
  });
  it("recognizes proof files", () => {
    expect(inferCategory("Interior Proof v2.pdf")).toBe("Proof");
  });
  it("recognizes manuscripts by keyword or .doc/.docx extension", () => {
    expect(inferCategory("Manuscript.pdf")).toBe("Manuscript");
    expect(inferCategory("My Book.docx")).toBe("Manuscript");
    expect(inferCategory("My Book.doc")).toBe("Manuscript");
  });
  it("falls back to Other", () => {
    expect(inferCategory("random.txt")).toBe("Other");
  });
  it("checks rules in priority order (cover before manuscript-by-extension)", () => {
    expect(inferCategory("Cover.docx")).toBe("Cover");
  });
});

describe("labelFromName", () => {
  it("strips the extension", () => {
    expect(labelFromName("Final Cover.jpg")).toBe("Final Cover");
  });
  it("leaves a name with no extension alone", () => {
    expect(labelFromName("README")).toBe("README");
  });
  it("does not treat a leading dot as an extension", () => {
    expect(labelFromName(".gitignore")).toBe(".gitignore");
  });
});

describe("isThumbnailEligible", () => {
  it("is true for images and PDFs only", () => {
    expect(isThumbnailEligible("image/png")).toBe(true);
    expect(isThumbnailEligible("application/pdf")).toBe(true);
    expect(isThumbnailEligible("application/msword")).toBe(false);
  });
});

describe("buildDriveFileView", () => {
  it("infers label/category and builds portal hrefs when there's no override", () => {
    const f = file({ id: "f1", name: "Final Cover.jpg", mimeType: "image/jpeg", size: 100, modifiedTime: "2026-01-01T00:00:00Z" });
    const view = buildDriveFileView(f, ["Book One"], null);
    expect(view).toEqual({
      id: "f1",
      name: "Final Cover.jpg",
      label: "Final Cover",
      category: "Cover",
      mimeType: "image/jpeg",
      size: 100,
      modifiedAt: "2026-01-01T00:00:00Z",
      href: "/api/files/d/f1",
      downloadHref: "/api/files/d/f1?download=1",
      thumbnailHref: "/api/files/d/f1/thumbnail",
      folderPath: ["Book One"],
    });
  });

  it("applies a staff label/category override", () => {
    const f = file({ id: "f2", name: "untitled.pdf", mimeType: "application/pdf" });
    const view = buildDriveFileView(f, [], { hidden: false, label: "Signed Contract", category: "Contract" });
    expect(view?.label).toBe("Signed Contract");
    expect(view?.category).toBe("Contract");
    expect(view?.thumbnailHref).toBe("/api/files/d/f2/thumbnail"); // PDFs are thumbnail-eligible
  });

  it("returns null when the override hides the file", () => {
    const f = file({ id: "f3", name: "internal-notes.txt", mimeType: "text/plain" });
    expect(buildDriveFileView(f, [], { hidden: true, label: "x", category: "y" })).toBeNull();
  });

  it("has no thumbnail for a non-image, non-PDF file", () => {
    const f = file({ id: "f4", name: "manuscript.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(buildDriveFileView(f, [], null)?.thumbnailHref).toBeNull();
  });
});
