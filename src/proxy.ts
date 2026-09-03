import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sessionCookieName, TWO_FA_COOKIE_NAME, isTwoFactorCookieValid } from "@/lib/auth/cookies";

/**
 * Route protection for the author area and `/admin`. `middleware.ts` is
 * deprecated in Next.js 16 in favor of `proxy.ts`.
 *
 * The matcher below only lists the routes that need gating, so `_next`,
 * `api/auth`, static files, and every public/(auth) page are never touched.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdminArea = pathname.startsWith("/admin");

  const isApi = pathname.startsWith("/api/");

  const session = await auth();
  if (!session?.user) {
    // API routes answer 401 instead of redirecting; they re-check the session themselves too.
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (!isAdminArea) return NextResponse.next();

  if (session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Admin 2FA gate. `session.user` intentionally doesn't carry `totpEnabled`
  // (keeping the auth contract to id/email/name/role), so this is one small,
  // indexed, per-request lookup — cheap at this app's scale.
  const [row] = await db.select({ totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, session.user.id)).limit(1);
  const totpEnabled = row?.totpEnabled ?? false;

  if (!totpEnabled) {
    if (pathname === "/admin/security") return NextResponse.next();
    return NextResponse.redirect(new URL("/admin/security", request.url));
  }

  const sessionToken = request.cookies.get(sessionCookieName())?.value;
  const twoFaCookie = request.cookies.get(TWO_FA_COOKIE_NAME)?.value;
  if (!isTwoFactorCookieValid(twoFaCookie, sessionToken)) {
    const url = new URL("/verify-2fa", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/books/:path*", "/account/:path*", "/admin/:path*", "/api/files/:path*", "/api/chat/:path*"],
};
