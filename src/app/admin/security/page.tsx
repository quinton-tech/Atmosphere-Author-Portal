import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { generateTotpSecret, totpKeyUri, totpQrDataUrl } from "@/lib/auth/totp";
import { EnrollTotpForm } from "./EnrollTotpForm";

export const metadata = { title: "Security" };

export default async function AdminSecurityPage() {
  const admin = await requireAdmin();
  const [row] = await db.select({ totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, admin.id)).limit(1);

  if (row?.totpEnabled) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-extrabold text-ink">Two-factor authentication</h1>
        <p className="mt-2 max-w-[60ch] text-sm text-muted">
          Two-factor authentication is on for your account. Every sign-in into <code className="text-ink-2">/admin</code>{" "}
          needs a fresh code from your authenticator app, once a day.
        </p>
      </div>
    );
  }

  const secret = generateTotpSecret();
  const uri = totpKeyUri(secret, admin.email);
  const qrDataUrl = await totpQrDataUrl(uri);

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-extrabold text-ink">Set up two-factor authentication</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-muted">
        Admin accounts require an authenticator app (1Password, Authy, Google Authenticator, etc). Scan the code
        below, then enter the 6-digit code it shows to finish setup.
      </p>
      <EnrollTotpForm secret={secret} qrDataUrl={qrDataUrl} manualKey={secret} />
    </div>
  );
}
