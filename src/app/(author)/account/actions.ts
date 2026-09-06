"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { contactInfoSchema } from "@/lib/hubspot/writes";
import { effectiveUserId, requireUser } from "@/lib/session";
import { updateAuthorContactInfo } from "@/lib/hubspot/contact-info";
import { setPassword, type SetPasswordResult } from "@/lib/auth/password";
import { forceSignOut } from "@/lib/auth/invite";
import { getSessionToken } from "@/lib/auth/db-session";


export async function updateContactInfoAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const raw = {
    phone: String(formData.get("phone") ?? ""),
    street: String(formData.get("street") ?? ""),
    city: String(formData.get("city") ?? ""),
    region: String(formData.get("region") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    country: String(formData.get("country") ?? ""),
  };
  const parsed = contactInfoSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the failing field (never its value: addresses and phone numbers don't belong in URLs).
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    redirect(`/account?contact=invalid${field ? `&field=${encodeURIComponent(field)}` : ""}`);
  }

  try {
    await updateAuthorContactInfo(effectiveUserId(user), parsed.data);
  } catch {
    redirect("/account?contact=error");
  }

  redirect("/account?contact=ok");
}


const setPasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1),
  confirmPassword: z.string().min(1),
});

/**
 * Always operates on the real signed-in user (`user.id`, never `effectiveUserId`) — an admin
 * "viewing as" an author must never be able to change that author's password.
 *
 * Redirects to `/account?password=<code>` where `<code>` is one of:
 * `invalid` (malformed submission), `mismatch` (new/confirm don't match), `wrong_current`
 * (current password field required/incorrect), `reauth` (magic-link-only account whose session
 * isn't recent enough — ask them to sign in again), `weak` (fails length/breach check), `error`
 * (unexpected failure), or `ok`. The "Current password" field name is `currentPassword` — the
 * Account page should render/require it whenever the signed-in user already has a password set
 * (see `hasPasswordHash` in `@/lib/auth/password`), and show `PASSWORD_RULES_TEXT` as help copy.
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = setPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword") || undefined,
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) redirect("/account?password=invalid");
  if (parsed.data.newPassword !== parsed.data.confirmPassword) redirect("/account?password=mismatch");

  const sessionToken = await getSessionToken();
  const result = await setPassword(user.id, parsed.data.newPassword, {
    currentPassword: parsed.data.currentPassword,
    currentSessionToken: sessionToken ?? null,
  }).catch((): SetPasswordResult => ({ ok: false, code: "error", error: "failed" }));

  if (!result.ok) redirect(`/account?password=${result.code}`);

  redirect("/account?password=ok");
}

export async function signOutEverywhereAction() {
  const user = await requireUser();
  await forceSignOut(user.id);
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/sign-in" });
}
