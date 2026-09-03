/**
 * MIME <-> extension mapping and filename helpers for the Drive file proxy.
 * No Drive/network deps here so this stays trivially unit-testable.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "image/tiff": "tiff",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/rtf": "rtf",
  "application/zip": "zip",
  "application/epub+zip": "epub",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/json": "json",
  // Google Workspace native types have no bytes of their own; DriveReader.stream()
  // always exports them to PDF, so they map to "pdf" here too.
  "application/vnd.google-apps.document": "pdf",
  "application/vnd.google-apps.spreadsheet": "pdf",
  "application/vnd.google-apps.presentation": "pdf",
  "application/vnd.google-apps.drawing": "pdf",
};

/** The single export target used for every Google Docs-family file. */
export const GOOGLE_EXPORT_MIME_TYPE = "application/pdf";

const GOOGLE_EXPORTABLE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.drawing",
]);

/** True for the Google-native types that have no downloadable bytes and must go through `files.export`. */
export function isGoogleExportableMimeType(mimeType: string | null | undefined): boolean {
  return !!mimeType && GOOGLE_EXPORTABLE_MIME_TYPES.has(mimeType.toLowerCase());
}

export function mimeToExtension(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

/** Matches ASCII control characters (0-31 and 127) without embedding any literal control bytes in source. */
function buildControlCharPattern(): RegExp {
  const chars: string[] = [];
  for (let i = 0; i <= 31; i++) chars.push(String.fromCharCode(i));
  chars.push(String.fromCharCode(127));
  const escaped = chars.map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  return new RegExp("[" + escaped + "]", "g");
}

const CONTROL_CHAR_PATTERN = buildControlCharPattern();

/**
 * Make a string safe to use as a filename and inside a `Content-Disposition` header value:
 * strips control characters and characters that are unsafe in filenames or header syntax,
 * collapses whitespace, and caps length. Never returns an empty string.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(CONTROL_CHAR_PATTERN, "")
    .replace(/["\\/:*?<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const capped = cleaned.length > 150 ? cleaned.slice(0, 150).trim() : cleaned;
  return capped || "file";
}

/** Sanitized label with the right extension appended (unless it's already there). */
export function buildFilename(label: string, mimeType: string | null | undefined): string {
  const base = sanitizeFilename(label);
  const ext = mimeToExtension(mimeType);
  if (!ext) return base;
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/** RFC 5987 percent-encoding for the `filename*` parameter (encodeURIComponent misses a few reserved chars). */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** True for printable, non-control, 7-bit ASCII (used to build the plain `filename` fallback). */
function isAsciiPrintable(code: number): boolean {
  return code >= 32 && code <= 126;
}

/**
 * Full `Content-Disposition` header value: an ASCII-safe `filename` fallback plus a
 * UTF-8 `filename*` for clients that support it, per RFC 6266 / RFC 5987.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  label: string,
  mimeType: string | null | undefined,
): string {
  const filename = buildFilename(label, mimeType);
  const ascii = Array.from(filename)
    .map((ch) => (isAsciiPrintable(ch.charCodeAt(0)) ? ch : "_"))
    .join("")
    .replace(/"/g, "'");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
