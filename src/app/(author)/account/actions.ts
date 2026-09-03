"use server";

import { redirect } from "next/navigation";
import { contactInfoSchema } from "@/lib/hubspot/writes";
import { effectiveUserId, requireUser } from "@/lib/session";
import { updateAuthorContactInfo } from "@/lib/hubspot/contact-info";
import { setPassword } from "@/lib/auth/password";
import { forceSignOut } from "@/lib/auth/invite";


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
    redirect("/account?contact=invalid");
  }

  try {
    await updateAuthorContactInfo(effectiveUserId(user), parsed.data);
  } catch {
    redirect("/account?contact=error");
  }

  redirect("/account?contact=ok");
}


export async function setPasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword.length < 12 || newPassword !== confirmPassword) {
    redirect("/account?password=invalid");
  }

  const result = await setPassword(user.id, newPassword).catch(() => ({ ok: false as const, error: "failed" }));
  if (!result.ok) redirect("/account?password=error");

  redirect("/account?password=ok");
}

export async function signOutEverywhereAction() {
  const user = await requireUser();
  await forceSignOut(user.id);
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/sign-in" });
}
