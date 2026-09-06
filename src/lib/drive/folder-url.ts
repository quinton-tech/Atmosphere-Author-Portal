/**
 * Pure parsing of a Google Drive folder id out of the URL staff paste into HubSpot's
 * "GD Link (Sync)" Project property (portal id `driveFolderUrl`, see hubspot/properties.ts).
 * No Drive/network/db deps here so this stays trivially unit-testable and importable from
 * `hubspot/plan.ts` (which must stay free of "server-only" — see that file's header comment).
 */

// Drive folder ids are URL-safe base64-ish: letters, digits, "-", "_". Real ids are long (usually
// 28-33 chars) but we don't hard-code a length here beyond a sanity floor (see BARE_ID below).
const ID_CHARS = "[a-zA-Z0-9_-]+";

/** `.../folders/<id>` or `.../folders/<id>/...` — the standard "Open folder" share link shape. */
const FOLDERS_PATH_PATTERN = new RegExp(`/folders/(${ID_CHARS})(?:[/?#]|$)`);
/** `?id=<id>` (or `&id=<id>`) — the older "open?id=" share link shape. */
const ID_QUERY_PATTERN = new RegExp(`[?&]id=(${ID_CHARS})`);
/** A bare id with no URL wrapper at all, in case staff paste just the id. */
const BARE_ID_PATTERN = new RegExp(`^(${ID_CHARS})$`);
const MIN_BARE_ID_LENGTH = 10;

/**
 * Extracts a Drive folder id from a pasted URL. Accepts:
 *   - `https://drive.google.com/drive/folders/<id>` (with or without a trailing `?usp=...`)
 *   - `https://drive.google.com/drive/folders/<id>/` (trailing slash)
 *   - `https://drive.google.com/open?id=<id>` (or any URL with an `id=` query param)
 *   - a bare folder id with no URL wrapper at all
 * Returns null for blank/missing input or anything that doesn't look like a folder id.
 */
export function parseDriveFolderId(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const foldersMatch = trimmed.match(FOLDERS_PATH_PATTERN);
  if (foldersMatch) return foldersMatch[1];

  const queryMatch = trimmed.match(ID_QUERY_PATTERN);
  if (queryMatch) return queryMatch[1];

  const bareMatch = trimmed.match(BARE_ID_PATTERN);
  if (bareMatch && bareMatch[1].length >= MIN_BARE_ID_LENGTH) return bareMatch[1];

  return null;
}
