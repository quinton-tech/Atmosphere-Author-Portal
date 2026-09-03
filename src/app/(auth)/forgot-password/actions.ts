"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/auth/password";
import { isPasswordResetRateLimited } from "@/lib/auth/rate-limit";

export type ForgotPasswordState = { submitted?: boolean; error?: string };

const emailSchema = z.string().trim().toLowerCase().email();

/** Never reveals whether the address has an account — same shape either way. */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (isPasswordResetRateLimited(parsed.data, ip)) {
    // Same "submitted" shape as success — rate-limit state must not reveal account existence either.
    return { submitted: true };
  }

  await requestPasswordReset(parsed.data);
  return { submitted: true };
}
