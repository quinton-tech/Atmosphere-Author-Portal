"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { verifyTotpCode } from "@/lib/auth/totp";
import { audit } from "@/lib/audit";

export type EnrollTotpState = { error?: string };

export async function enrollTotpAction(_prev: EnrollTotpState, formData: FormData): Promise<EnrollTotpState> {
  const admin = await requireAdmin();
  const secret = String(formData.get("secret") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!secret) return { error: "Something went wrong generating your key. Reload the page and try again." };

  const ok = await verifyTotpCode(secret, code);
  if (!ok) return { error: "That code didn't match. Check the time on your device and try again." };

  await db.update(users).set({ totpSecret: secret, totpEnabled: true }).where(eq(users.id, admin.id));
  await audit(admin.id, "auth.totp_enabled", { targetType: "user", targetId: admin.id });

  redirect("/admin");
}
