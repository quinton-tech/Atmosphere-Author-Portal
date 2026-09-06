/**
 * Fetches the "Our Team" page through the site's public WordPress REST API. The HTML page itself
 * sits behind bot protection (403 for non-browser clients); the REST endpoint is open.
 */
import { parseTeamPage, type TeamMemberImport } from "./parse";

export const TEAM_PAGE_REST_URL = "https://atmospherepress.com/wp-json/wp/v2/pages?slug=ourteam&_fields=id,slug,modified,content";

export async function fetchTeamPage(fetchImpl: typeof fetch = fetch): Promise<{ modified: string; members: TeamMemberImport[] }> {
  const res = await fetchImpl(TEAM_PAGE_REST_URL, { headers: { "User-Agent": "AtmosphereAuthorPortal/1.0 (+team directory import)" } });
  if (!res.ok) throw new Error(`Team page fetch failed: HTTP ${res.status}`);
  const pages = (await res.json()) as Array<{ modified: string; content: { rendered: string } }>;
  const page = pages[0];
  if (!page?.content?.rendered) throw new Error("Team page fetch returned no content");
  const members = parseTeamPage(page.content.rendered);
  if (members.length < 10) throw new Error(`Team page parse looks wrong: only ${members.length} members found`);
  return { modified: page.modified, members };
}
