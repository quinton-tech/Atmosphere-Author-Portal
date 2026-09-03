"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { audit } from "@/lib/audit";
import { currentUser, VIEW_AS_COOKIE } from "@/lib/session";

/** Ends an admin's "view as author" session. Posted to by the coral banner on every author page. */
export async function stopViewAs() {
  const user = await currentUser();
  const viewedUserId = user?.viewingAs?.userId ?? null;

  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE);

  if (user && viewedUserId) {
    await audit(user.id, "admin.stop_view_as", { targetType: "user", targetId: viewedUserId });
  }

  redirect("/admin/authors");
}

/** Plain sign-out for the current session. Header "Sign out" link. */
export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}
