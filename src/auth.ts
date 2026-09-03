/**
 * Auth.js v5 config. Database sessions via the Drizzle adapter (not JWT) so
 * admins can revoke access by deleting `sessions` rows.
 *
 * Providers: Resend magic link (no account enumeration — see
 * `sendVerificationRequest` below) and Credentials (email + Argon2id
 * password). Note: the `/sign-in` page's password form does NOT call
 * `signIn("credentials", …)` — see `src/lib/auth/db-session.ts` for why
 * (Auth.js always issues a JWT for Credentials sign-ins, even under a
 * "database" strategy) and how the app gets a real, revocable database
 * session for password logins anyway. The Credentials provider below is kept
 * so the contract is complete and so `authorize()` has one shared,
 * well-tested implementation (`verifyPasswordLogin`) either path can use.
 */
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { verifyPasswordLogin } from "@/lib/auth/password";
import { isLoginRateLimited } from "@/lib/auth/rate-limit";
import { sendMagicLinkEmail } from "@/lib/auth/email";
import type { Role } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: Role;
    };
  }
}

export const { auth, signIn, signOut, handlers } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  secret: env.AUTH_SECRET,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/check-email",
    error: "/sign-in",
  },
  providers: [
    Resend({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      maxAge: 15 * 60, // 15 minutes
      async sendVerificationRequest({ identifier: email, url }) {
        // Only send if a user row exists and isn't disabled — otherwise silently
        // succeed. Auth.js always redirects to /check-email regardless, so this
        // never reveals whether the address has an account.
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || user.disabledAt) return;
        await sendMagicLinkEmail(email, url);
      },
    }),
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        if (isLoginRateLimited(email, ip)) return null;

        const user = await verifyPasswordLogin(email, password);
        if (!user) return null;
        return user;
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      const dbUser = user as unknown as { id: string; email: string; name: string | null; role: Role };
      return {
        ...session,
        user: {
          ...session.user,
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role,
        },
      };
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(user.id, "auth.login");
    },
  },
});
