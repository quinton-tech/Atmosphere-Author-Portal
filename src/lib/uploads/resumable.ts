/**
 * Pure helpers for Google Drive's resumable-upload wire protocol
 * (https://developers.google.com/drive/api/guides/manage-uploads#resumable). No DOM/XHR here —
 * `src/lib/uploads/resumable-client.ts` does the actual network calls — so this stays trivially
 * unit-testable, same reasoning as `src/lib/drive/mime.ts`.
 */

/**
 * Parses the `Range` response header Google returns on a `308 Resume Incomplete` status check
 * (e.g. `bytes=0-12345`, always starting at 0 per Google's protocol) into the offset to resume
 * the next PUT from — i.e. one past the last byte Drive has already received. Returns 0 when the
 * header is absent (nothing received yet) or doesn't match the expected shape.
 */
export function parseResumeOffset(rangeHeader: string | null | undefined): number {
  if (!rangeHeader) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(rangeHeader.trim());
  return match ? Number(match[1]) + 1 : 0;
}

/** `Content-Range` header for a status-check PUT (empty body): asks Drive how much of `totalBytes`
 *  it has received so far, without sending any more data. */
export function statusCheckContentRange(totalBytes: number): string {
  return `bytes */${totalBytes}`;
}

/** `Content-Range` header for resuming a PUT with the remaining bytes, starting at `offset`. */
export function resumeContentRange(offset: number, totalBytes: number): string {
  return `bytes ${offset}-${totalBytes - 1}/${totalBytes}`;
}

/** Reads the new file's Drive id out of the JSON body a successful (200/201) resumable PUT
 *  returns (`{ id, webViewLink }`, per the `fields=id,webViewLink` on the session request). */
export function parseDriveFileId(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
  } catch {
    return null;
  }
}
