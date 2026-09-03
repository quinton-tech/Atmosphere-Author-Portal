import { describe, expect, it } from "vitest";
import {
  buildFilename,
  contentDisposition,
  GOOGLE_EXPORT_MIME_TYPE,
  isGoogleExportableMimeType,
  mimeToExtension,
  sanitizeFilename,
} from "./mime";

describe("mimeToExtension", () => {
  it("maps common file types", () => {
    expect(mimeToExtension("application/pdf")).toBe("pdf");
    expect(mimeToExtension("image/jpeg")).toBe("jpg");
    expect(mimeToExtension("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
  });
  it("maps Google Workspace native types to pdf (the export target)", () => {
    expect(mimeToExtension("application/vnd.google-apps.document")).toBe(GOOGLE_EXPORT_MIME_TYPE.split("/")[1]);
    expect(mimeToExtension("application/vnd.google-apps.spreadsheet")).toBe("pdf");
    expect(mimeToExtension("application/vnd.google-apps.presentation")).toBe("pdf");
  });
  it("is case-insensitive", () => {
    expect(mimeToExtension("Application/PDF")).toBe("pdf");
  });
  it("returns null for unknown or missing mime types", () => {
    expect(mimeToExtension("application/x-nonsense")).toBeNull();
    expect(mimeToExtension(null)).toBeNull();
    expect(mimeToExtension(undefined)).toBeNull();
  });
});

describe("isGoogleExportableMimeType", () => {
  it("is true only for the Google Docs-family native types", () => {
    expect(isGoogleExportableMimeType("application/vnd.google-apps.document")).toBe(true);
    expect(isGoogleExportableMimeType("application/vnd.google-apps.folder")).toBe(false);
    expect(isGoogleExportableMimeType("application/pdf")).toBe(false);
    expect(isGoogleExportableMimeType(null)).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips path and header-unsafe characters", () => {
    expect(sanitizeFilename('My "Book" / Draft: v2?')).toBe("My -Book- - Draft- v2-");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeFilename("  Chapter   One  \n\n Notes  ")).toBe("Chapter One Notes");
  });
  it("strips control characters", () => {
    const withBell = "Bad" + String.fromCharCode(7) + "Name";
    expect(sanitizeFilename(withBell)).toBe("BadName");
  });
  it("caps length", () => {
    const long = "a".repeat(300);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(150);
  });
  it("never returns an empty string", () => {
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename("///")).not.toBe("");
  });
});

describe("buildFilename", () => {
  it("appends the correct extension", () => {
    expect(buildFilename("Cover Art", "image/png")).toBe("Cover Art.png");
  });
  it("does not double up an existing extension", () => {
    expect(buildFilename("manuscript.pdf", "application/pdf")).toBe("manuscript.pdf");
  });
  it("exports Google Docs to a .pdf name", () => {
    expect(buildFilename("Chapter 1", "application/vnd.google-apps.document")).toBe("Chapter 1.pdf");
  });
  it("falls back to the sanitized label with no extension for unknown types", () => {
    expect(buildFilename("mystery-file", "application/x-nonsense")).toBe("mystery-file");
  });
});

describe("contentDisposition", () => {
  it("builds inline vs attachment dispositions", () => {
    expect(contentDisposition("inline", "Cover.png", "image/png")).toMatch(/^inline; filename="Cover\.png"/);
    expect(contentDisposition("attachment", "Cover.png", "image/png")).toMatch(/^attachment; filename="Cover\.png"/);
  });
  it("includes an ASCII fallback and a UTF-8 filename* for non-ASCII labels", () => {
    const header = contentDisposition("inline", "Résumé", "application/pdf");
    expect(header).toContain('filename="R_sum_.pdf"');
    expect(header).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9.pdf");
  });
  it("never lets a quote in the label break out of the quoted filename", () => {
    const header = contentDisposition("inline", 'Say "hi".txt', "text/plain");
    expect(header).not.toMatch(/filename="[^"]*"[^;]/);
  });
});
