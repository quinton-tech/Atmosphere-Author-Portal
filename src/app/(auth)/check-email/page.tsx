import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your email"
      subtitle="If an account exists for that address, we've sent you a sign-in link."
    >
      <div className="space-y-4 text-sm text-ink-2">
        <p>The link is valid for 15 minutes and works once. You can close this tab.</p>
        <p className="text-muted">
          Didn&apos;t get it? Check spam, or{" "}
          <a href="/sign-in" className="font-medium text-teal-ink underline underline-offset-2">
            try again
          </a>
          .
        </p>
      </div>
    </AuthShell>
  );
}
