import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyTwoFactorForm } from "./VerifyTwoFactorForm";

export const metadata = { title: "Verify it's you" };

export default async function VerifyTwoFaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");

  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/admin") ? next : "/admin";

  return (
    <AuthShell title="Verify it's you" subtitle="Enter the 6-digit code from your authenticator app.">
      <VerifyTwoFactorForm next={safeNext} />
    </AuthShell>
  );
}
