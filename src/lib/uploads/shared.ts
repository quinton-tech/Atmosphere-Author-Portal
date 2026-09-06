/**
 * Framework-agnostic constants and formatters shared between the server-rendered `UploadForm`
 * wrapper, the client-side `UploadFormClient`, and the pages that list past uploads. No
 * "use client" / "server-only" directive on purpose (matching `src/lib/types.ts`'s "safe to
 * import from client components" convention) — this module is imported from both sides, and a
 * directive on either end would put it on the wrong side of the RSC client/server boundary.
 */

export const UPLOAD_KIND_LABELS: Record<string, string> = {
  manuscript: "Manuscript",
  form: "Form / paperwork",
  other: "Other",
};

export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  stored: "Sent",
  demo: "Sent (demo)",
  pending: "Sending…",
  failed: "Failed",
};

export const UPLOAD_ACCEPT = ".pdf,.docx,.doc,.rtf,.txt,.jpg,.jpeg,.png,.zip";

export function formatUploadBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUploadDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}
