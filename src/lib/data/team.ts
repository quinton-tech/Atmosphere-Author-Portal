import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers, type TeamMemberRow } from "@/db/schema-team";
import { nameKey } from "@/lib/team/parse";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; map: Map<string, TeamMemberRow> } | null = null;

/**
 * The public team directory (rows with showToAuthors=true), keyed by nameKey() for matching
 * against HubSpot-assigned team member names. In-process cache for 5 minutes — this is read on
 * every book page render, and the directory changes rarely (an admin import or edit).
 */
export async function getTeamDirectory(): Promise<Map<string, TeamMemberRow>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  const rows = await db.select().from(teamMembers).where(eq(teamMembers.showToAuthors, true));
  const map = new Map(rows.map((r) => [r.nameKey, r]));
  cache = { at: Date.now(), map };
  return map;
}

/** Convenience lookup for a single HubSpot-assigned name, using the cached directory. */
export async function matchTeamMember(name: string): Promise<TeamMemberRow | null> {
  const directory = await getTeamDirectory();
  return directory.get(nameKey(name)) ?? null;
}
