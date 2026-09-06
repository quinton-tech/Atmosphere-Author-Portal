"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { verifyTotpCode } from "@/lib/auth/totp";
import { isTotpRateLimited } from "@/lib/auth/rate-limit";
import { getSessionToken, markTwoFactorVerified } from "@/lib/auth/db-session";

export type VerifyTwoFaState = { error?: string };

function safeAdminNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/admin") ? value : "/admin";
}

export async function verifyTwoFactorCodeAction(_prev: VerifyTwoFaState, formData: FormData): Promise<VerifyTwoFaState> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");

  const code = String(formData.get("code") ?? "");
  const next = safeAdminNext(formData.get("next"));

  if (await isTotpRateLimited(user.id)) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const [row] = await db
    .select({ totpSecret: users.totpSecret, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.totpEnabled || !row.totpSecret) redirect("/admin/security");

  const ok = await verifyTotpCode(row.totpSecret, code);
  if (!ok) return { error: "That code didn't work. Try again." };

  const sessionToken = await getSessionToken();
  if (!sessionToken) redirect("/sign-in");
  await markTwoFactorVerified(sessionToken);

  redirect(next);
}
