"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { verifyPasswordLogin } from "@/lib/auth/password";
import { isLoginRateLimited } from "@/lib/auth/rate-limit";
import { createDatabaseSession, setSessionCookie } from "@/lib/auth/db-session";

export type SignInState = { error?: string };

const emailSchema = z.string().trim().toLowerCase().email();

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  // Reject "//host" (protocol-relative) AND "/\host" / "\host" — browsers resolve a leading
  // backslash the same as a second slash when parsing a relative reference (WHATWG URL spec),
  // so "/\evil.com" becomes an off-site redirect to evil.com despite passing a naive "//" check.
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/dashboard";
}

/** "Send me a link" — always redirects to /check-email; never reveals whether the address has an account. */
export async function requestMagicLinkAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  await signIn("resend", { email: parsed.data, redirectTo: safeNext(formData.get("next")) });
  return {};
}

/**
 * "Use my password." Deliberately does NOT call `signIn("credentials", …)` —
 * see `src/lib/auth/db-session.ts` for why (Auth.js always issues a JWT for
 * Credentials sign-ins). Instead this verifies the password directly and
 * creates a real, revocable database session itself.
 */
export async function signInWithPasswordAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (isLoginRateLimited(parsed.data.email, ip)) {
    return { error: "Too many attempts. Try again in a few minutes, or use a sign-in link instead." };
  }

  const user = await verifyPasswordLogin(parsed.data.email, parsed.data.password);
  if (!user) return { error: "Invalid email or password." };

  const { token, expires } = await createDatabaseSession(user.id);
  await setSessionCookie(token, expires);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit(user.id, "auth.login");

  redirect(safeNext(formData.get("next")));
}
