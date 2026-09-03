import { AuthShell } from "@/components/auth/AuthShell";
import { FormError } from "@/components/auth/fields";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 12 characters.">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <FormError message="This link is missing its token. Request a new one from the forgot password page." />
      )}
    </AuthShell>
  );
}
