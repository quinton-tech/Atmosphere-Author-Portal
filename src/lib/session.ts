import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { SessionUser } from "@/lib/types";

export const VIEW_AS_COOKIE = "ap_view_as";

/** Signed-in user or null. Resolves admin "view as author" into `viewingAs`. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const base: SessionUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    role: session.user.role,
  };
  if (base.role !== "admin") return base;

  const jar = await cookies();
  const viewAs = jar.get(VIEW_AS_COOKIE)?.value;
  if (!viewAs) return base;
  const [target] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, viewAs))
    .limit(1);
  if (!target) return base;
  return { ...base, viewingAs: { userId: target.id, email: target.email, name: target.name } };
}

/** The user whose data should be shown: the author, or the author an admin is viewing as. */
export function effectiveUserId(u: SessionUser): string {
  return u.viewingAs?.userId ?? u.id;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/sign-in");
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/sign-in");
  if (u.role !== "admin") redirect("/");
  return u;
}
