import { describe, expect, it } from "vitest";
import { parseDriveFileId, parseResumeOffset, resumeContentRange, statusCheckContentRange } from "./resumable";

describe("parseResumeOffset", () => {
  it("returns the byte to resume from after a partial receipt", () => {
    expect(parseResumeOffset("bytes=0-1023")).toBe(1024);
  });
  it("returns 0 when nothing has been received yet", () => {
    expect(parseResumeOffset(null)).toBe(0);
    expect(parseResumeOffset(undefined)).toBe(0);
    expect(parseResumeOffset("")).toBe(0);
  });
  it("returns 0 for a header it doesn't recognize", () => {
    expect(parseResumeOffset("not-a-range-header")).toBe(0);
  });
});

describe("statusCheckContentRange", () => {
  it("builds Google's status-check Content-Range value", () => {
    expect(statusCheckContentRange(5000)).toBe("bytes */5000");
  });
});

describe("resumeContentRange", () => {
  it("builds the Content-Range for the remaining bytes", () => {
    expect(resumeContentRange(1024, 5000)).toBe("bytes 1024-4999/5000");
  });
  it("covers the whole file when resuming from 0", () => {
    expect(resumeContentRange(0, 100)).toBe("bytes 0-99/100");
  });
});

describe("parseDriveFileId", () => {
  it("reads the id out of Drive's JSON body", () => {
    expect(parseDriveFileId('{"id":"abc123","webViewLink":"https://example.com"}')).toBe("abc123");
  });
  it("returns null for unparseable bodies", () => {
    expect(parseDriveFileId("not json")).toBeNull();
  });
  it("returns null when the body has no usable id", () => {
    expect(parseDriveFileId("{}")).toBeNull();
    expect(parseDriveFileId('{"id":""}')).toBeNull();
    expect(parseDriveFileId('{"id":123}')).toBeNull();
  });
});
