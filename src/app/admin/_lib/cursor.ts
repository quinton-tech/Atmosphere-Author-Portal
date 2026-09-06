/** Opaque keyset-pagination cursors for admin list pages. Never offset/limit over unbounded tables. */

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const PAGE_SIZE = 50;

/**
 * Keyset pagination has no cheap symmetric "previous page" query, so admin list pages that only
 * ever showed "Next" carry a small "trail" of the cursors used to reach the current page in the
 * URL (`?cursor=...&trail=...`). Going forward pushes the current page's cursor onto the trail;
 * going back pops the last one off. A page-1 cursor (undefined) is pushed as an empty segment so
 * the trail's length always matches "how many pages back we can go."
 *
 * Segments are "~"-joined — cursors are base64url (letters, digits, "-", "_"), so "~" can't
 * collide with one.
 */
const TRAIL_SEP = "~";

/** "0" = page 1 (no cursor); "1<cursor>" = a real cursor. Never collapses to an empty string for
 *  a non-empty trail, so `hasPrevPage` can tell "no history" apart from "one hop of history whose
 *  cursor was empty" purely by string length. */
function encodeSeg(cursor: string | undefined): string {
  return cursor ? `1${cursor}` : "0";
}
function decodeSeg(seg: string): string | undefined {
  return seg.startsWith("1") ? seg.slice(1) : undefined;
}

export function trailPush(trail: string | undefined, cursor: string | undefined): string {
  const segs = trail ? trail.split(TRAIL_SEP) : [];
  segs.push(encodeSeg(cursor));
  return segs.join(TRAIL_SEP);
}

export function trailPop(trail: string | undefined): { cursor: string | undefined; trail: string } {
  const segs = trail ? trail.split(TRAIL_SEP) : [];
  const last = segs.pop();
  return { cursor: last !== undefined ? decodeSeg(last) : undefined, trail: segs.join(TRAIL_SEP) };
}

/** Whether a Previous link should show at all: only once we've navigated forward at least once. */
export function hasPrevPage(trail: string | undefined): boolean {
  return !!trail && trail.length > 0;
}
