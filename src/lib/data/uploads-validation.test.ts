import { describe, expect, it } from "vitest";
import {
  DEMO_MAX_UPLOAD_BYTES,
  extensionOf,
  isPendingExpired,
  MAX_UPLOAD_BYTES,
  UploadError,
  validateUploadMeta,
} from "./uploads-validation";

describe("extensionOf", () => {
  it("lowercases and strips the leading dot", () => {
    expect(extensionOf("Manuscript.DOCX")).toBe("docx");
  });
  it("returns null with no extension", () => {
    expect(extensionOf("noextension")).toBeNull();
  });
});

describe("validateUploadMeta", () => {
  const ok = { fileName: "manuscript.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

  it("accepts an allowed extension within the size cap and returns the canonical mime type", () => {
    const result = validateUploadMeta(ok, { maxBytes: MAX_UPLOAD_BYTES });
    expect(result).toEqual({ mimeType: "application/pdf", extension: "pdf" });
  });

  it("derives the canonical mime type from the extension, ignoring a mismatched claimed mimeType", () => {
    const result = validateUploadMeta({ ...ok, mimeType: "text/plain" }, { maxBytes: MAX_UPLOAD_BYTES });
    expect(result.mimeType).toBe("application/pdf");
  });

  it("rejects a disallowed extension", () => {
    expect(() => validateUploadMeta({ ...ok, fileName: "installer.exe" }, { maxBytes: MAX_UPLOAD_BYTES })).toThrow(UploadError);
  });

  it("rejects a missing extension", () => {
    expect(() => validateUploadMeta({ ...ok, fileName: "noextension" }, { maxBytes: MAX_UPLOAD_BYTES })).toThrow(UploadError);
  });

  it("rejects a zero-byte file", () => {
    expect(() => validateUploadMeta({ ...ok, sizeBytes: 0 }, { maxBytes: MAX_UPLOAD_BYTES })).toThrow(UploadError);
  });

  it("rejects a file over the real 50MB cap", () => {
    expect(() => validateUploadMeta({ ...ok, sizeBytes: MAX_UPLOAD_BYTES + 1 }, { maxBytes: MAX_UPLOAD_BYTES })).toThrow(/50 MB/);
  });

  it("rejects a file over the demo-mode 4MB fallback cap even though it's under the real cap", () => {
    expect(() =>
      validateUploadMeta({ ...ok, sizeBytes: DEMO_MAX_UPLOAD_BYTES + 1 }, { maxBytes: DEMO_MAX_UPLOAD_BYTES }),
    ).toThrow(/4 MB/);
  });
});

describe("isPendingExpired", () => {
  const now = new Date("2026-01-02T00:00:00Z");

  it("is not expired just under 24h old", () => {
    const createdAt = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    expect(isPendingExpired(createdAt, now)).toBe(false);
  });

  it("is expired just over 24h old", () => {
    const createdAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isPendingExpired(createdAt, now)).toBe(true);
  });
});
