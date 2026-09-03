"use server";

import { resetPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

export type ResetPasswordState = { error?: string; success?: boolean };

export async function resetPasswordAction(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { error: "This link is invalid. Request a new one." };
  if (password.length < PASSWORD_MIN_LENGTH) return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  if (password !== confirm) return { error: "Passwords don't match." };

  const result = await resetPassword(token, password);
  if (!result.ok) return { error: result.error };
  return { success: true };
}
