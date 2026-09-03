import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };

function safeNext(next: string | undefined): string {
  // Kept in sync with the identical guard in ./actions.ts (see comment there re: the
  // leading-backslash open-redirect bypass) — this copy only affects what's pre-filled into the
  // form's hidden `next` field, but it must reject the same values or a crafted link could still
  // round-trip an unsafe value back to the action.
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === "admin" ? "/admin" : "/dashboard");
  }

  const { next } = await searchParams;

  return (
    <AuthShell title="Sign in" subtitle="We'll email you a one-time link — or sign in with your password if you've set one.">
      <SignInForm next={safeNext(next)} />
    </AuthShell>
  );
}
