import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export type AuthorProfile = {
  phone: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string;
  syncedAt: string | null;
};

/**
 * The author's canonical contact profile. Unlike `getAuthorInfoForUser` in `src/lib/data/books.ts`
 * (which reads phone/address off the most recently synced book's Project properties — a source
 * that a later Project sync can silently overwrite, see review finding #1), this reads the `users`
 * row: the HubSpot Contact mirrored in at sync time by `applyPlan` in `sync.ts`, and kept current on
 * every successful author edit by `updateAuthorContactInfo` in `contact-info.ts`. This is the
 * profile source pages should switch to.
 */
export async function getAuthorProfile(userId: string): Promise<AuthorProfile | null> {
  const [row] = await db
    .select({
      phone: users.phone,
      street: users.street,
      city: users.city,
      region: users.region,
      postalCode: users.postalCode,
      country: users.country,
      email: users.email,
      profileSyncedAt: users.profileSyncedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    phone: row.phone,
    street: row.street,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    email: row.email,
    syncedAt: row.profileSyncedAt?.toISOString() ?? null,
  };
}
