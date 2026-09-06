import { describe, expect, it } from "vitest";
import { parseDriveFolderId } from "./folder-url";

describe("parseDriveFolderId", () => {
  it("parses the standard /folders/<id> share link", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe(
      "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    );
  });

  it("parses /folders/<id> with a trailing query string", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbCdEf?usp=sharing")).toBe("1AbCdEf");
  });

  it("parses /folders/<id>/ with a trailing slash", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbCdEf/")).toBe("1AbCdEf");
  });

  it("parses ?id=<id> links", () => {
    expect(parseDriveFolderId("https://drive.google.com/open?id=1AbCdEf")).toBe("1AbCdEf");
  });

  it("parses ?id=<id> when it isn't the first query param", () => {
    expect(parseDriveFolderId("https://drive.google.com/open?authuser=0&id=1AbCdEf&foo=bar")).toBe("1AbCdEf");
  });

  it("accepts a bare id with no URL wrapper", () => {
    expect(parseDriveFolderId("1AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDriveFolderId("  https://drive.google.com/drive/folders/1AbCdEf  ")).toBe("1AbCdEf");
  });

  it("returns null for blank, missing, or short/unrecognized input", () => {
    expect(parseDriveFolderId(null)).toBeNull();
    expect(parseDriveFolderId(undefined)).toBeNull();
    expect(parseDriveFolderId("")).toBeNull();
    expect(parseDriveFolderId("   ")).toBeNull();
    expect(parseDriveFolderId("not a url")).toBeNull();
    expect(parseDriveFolderId("https://example.com/")).toBeNull();
    expect(parseDriveFolderId("short")).toBeNull();
  });
});
