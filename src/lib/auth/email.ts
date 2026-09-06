import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

function client(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  return new Resend(env.RESEND_API_KEY);
}

/** On-brand transactional email shell: Roboto, white ground, one black pill button. */
function shell({ preheader, heading, body, ctaLabel, ctaUrl }: {
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Roboto,Helvetica,Arial,sans-serif;color:#1a1b1d;">
    <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
            <tr>
              <td style="padding-bottom:24px;">
                <span style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#1a1b1d;">atmosphere</span>
                <span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#69727d;margin-left:8px;">Author Portal</span>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:16px;">
                <h1 style="margin:0;font-size:22px;font-weight:800;color:#1a1b1d;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;font-size:15px;line-height:1.6;color:#3f444b;">${body}</td>
            </tr>
            <tr>
              <td style="padding-bottom:32px;">
                <a href="${ctaUrl}" style="display:inline-block;background:#1a1b1d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:999px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:1.6;color:#69727d;border-top:1px solid #dfe3e6;padding-top:16px;">
                If the button doesn't work, copy and paste this link into your browser:<br />
                <a href="${ctaUrl}" style="color:#2a7f96;word-break:break-all;">${ctaUrl}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  await client().emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Sign in to your Author Portal",
    html: shell({
      preheader: "Your sign-in link is ready — it expires in 15 minutes.",
      heading: "Sign in to your Author Portal",
      body: "Use the button below to sign in. This link is valid for 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.",
      ctaLabel: "Sign in",
      ctaUrl: url,
    }),
    text: `Sign in to your Author Portal: ${url}\n\nThis link is valid for 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.`,
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Staff-facing notification for a new author upload (src/lib/data/uploads.ts). Not part of the
 * auth flow, but reuses this file's `shell()` since it's the only on-brand transactional-email
 * template in the codebase. Skipped entirely when RESEND_API_KEY or UPLOADS_NOTIFY_EMAIL is
 * unset — see `isUploadsConfigured` callers upstream.
 */
export async function sendUploadNotificationEmail(
  to: string,
  info: { authorName: string; bookTitle: string | null; fileName: string; sizeBytes: number; driveWebViewLink: string | null },
): Promise<void> {
  const bookLine = info.bookTitle ? ` for <strong>${info.bookTitle}</strong>` : "";
  const ctaUrl = info.driveWebViewLink ?? "https://drive.google.com/drive/my-drive";
  await client().emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `New upload from ${info.authorName}`,
    html: shell({
      preheader: `${info.authorName} sent a file${info.bookTitle ? ` for ${info.bookTitle}` : ""}.`,
      heading: "New author upload",
      body: `<strong>${info.authorName}</strong> sent a file${bookLine} through the portal:<br /><br />${info.fileName} (${formatBytes(info.sizeBytes)})`,
      ctaLabel: "Open in Drive",
      ctaUrl,
    }),
    text: `${info.authorName} sent a file${info.bookTitle ? ` for ${info.bookTitle}` : ""}: ${info.fileName} (${formatBytes(info.sizeBytes)})\n${ctaUrl}`,
  });
}

/**
 * Fires after any successful password change or reset (see `password.ts`, which resolves
 * `signInUrl` the same way it resolves the reset-link base URL). No CTA URL to click other than
 * "go sign in", since the shell template requires one.
 */
export async function sendPasswordChangedEmail(to: string, signInUrl: string): Promise<void> {
  await client().emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Your Author Portal password was changed",
    html: shell({
      preheader: "Your password was just changed.",
      heading: "Password changed",
      body: "Your Atmosphere Author Portal password was changed. If this wasn't you, contact your main contact right away — your other sessions have been signed out.",
      ctaLabel: "Sign in",
      ctaUrl: signInUrl,
    }),
    text: `Your Atmosphere Author Portal password was changed. If this wasn't you, contact your main contact right away — your other sessions have been signed out.\n\n${signInUrl}`,
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await client().emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Reset your Author Portal password",
    html: shell({
      preheader: "Reset your password — this link expires in 30 minutes.",
      heading: "Reset your password",
      body: "We got a request to reset your Author Portal password. This link is valid for 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.",
      ctaLabel: "Choose a new password",
      ctaUrl: url,
    }),
    text: `Reset your Author Portal password: ${url}\n\nThis link is valid for 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email.`,
  });
}
