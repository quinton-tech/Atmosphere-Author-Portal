import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { handbookVersions, type HandbookVersion } from "@/db/schema";
import { audit } from "@/lib/audit";
import { estimateTokens, extractText, splitIntoSections } from "./handbook-text";

export { extractText, estimateTokens, splitIntoSections } from "./handbook-text";

/** Parse + split + persist a new (inactive) handbook version. Admin must call `activateHandbook`. */
export async function ingestHandbook(
  file: { name: string; bytes: Uint8Array },
  opts: { uploadedById?: string | null } = {},
): Promise<HandbookVersion> {
  const text = await extractText(file);
  const sections = splitIntoSections(text);
  const tokenEstimate = sections.length > 0 ? sections.reduce((sum, s) => sum + s.tokenEstimate, 0) : estimateTokens(text);

  const [row] = await db
    .insert(handbookVersions)
    .values({
      filename: file.name,
      uploadedById: opts.uploadedById ?? null,
      text,
      sections,
      tokenEstimate,
      isActive: false,
    })
    .returning();

  await audit(opts.uploadedById ?? null, "admin.handbook.upload", {
    targetType: "handbook_version",
    targetId: row.id,
    meta: { filename: file.name, sections: sections.length, tokenEstimate },
  });

  return row;
}

/**
 * Flip the active handbook version. Uses `db.batch` (atomic on the neon-http driver) rather than
 * `db.transaction`, which the neon-http driver does not support.
 */
export async function activateHandbook(id: string, actorId: string | null): Promise<void> {
  await db.batch([
    db.update(handbookVersions).set({ isActive: false }).where(eq(handbookVersions.isActive, true)),
    db.update(handbookVersions).set({ isActive: true }).where(eq(handbookVersions.id, id)),
  ]);
  invalidateActiveHandbookCache();
  await audit(actorId, "admin.handbook.activate", { targetType: "handbook_version", targetId: id });
}

const ACTIVE_HANDBOOK_CACHE_MS = 60_000;
let activeHandbookCache: { value: HandbookVersion | null; expiresAt: number } | null = null;

/** The current active handbook version, cached in-process for 60s (brief: "cached per process for 60 s"). */
export async function getActiveHandbook(): Promise<HandbookVersion | null> {
  const now = Date.now();
  if (activeHandbookCache && activeHandbookCache.expiresAt > now) return activeHandbookCache.value;

  const [row] = await db
    .select()
    .from(handbookVersions)
    .where(eq(handbookVersions.isActive, true))
    .orderBy(desc(handbookVersions.createdAt))
    .limit(1);

  activeHandbookCache = { value: row ?? null, expiresAt: now + ACTIVE_HANDBOOK_CACHE_MS };
  return activeHandbookCache.value;
}

/** Exposed for admin actions/tests that need the cache to reflect a just-written change immediately. */
export function invalidateActiveHandbookCache(): void {
  activeHandbookCache = null;
}
