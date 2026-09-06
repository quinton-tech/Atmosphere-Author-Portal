"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { effectiveUserId, requireUser } from "@/lib/session";
import { createUploadForUser, UploadError, UPLOAD_KINDS } from "@/lib/data/uploads";

const uploadSchema = z.object({
  bookId: z.string().uuid().optional().or(z.literal("")),
  kind: z.enum(UPLOAD_KINDS),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Only ever redirects back into this app — used so the form can be embedded on /uploads or on a
 *  book's Files area and land the author back where they submitted from. */
function safeRedirectBase(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/uploads";
}

function redirectWithFlash(base: string, kind: "ok" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`${base}?${params.toString()}`);
}

export async function uploadFileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const redirectBase = safeRedirectBase(formData.get("redirectTo"));

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirectWithFlash(redirectBase, "error", "Please choose a file to send.");
  }

  const parsed = uploadSchema.safeParse({
    bookId: formData.get("bookId") ?? "",
    kind: formData.get("kind"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    redirectWithFlash(redirectBase, "error", "Please check the highlighted fields and try again.");
  }

  try {
    // Ownership of bookId (when set) is re-checked inside createUploadForUser via
    // listBooksForUser — never trusted just because the form said so, whether that form was the
    // free-standing /uploads picker or a book's Files area with the book "fixed".
    await createUploadForUser(effectiveUserId(user), {
      bookId: parsed.data.bookId || null,
      kind: parsed.data.kind,
      note: parsed.data.note || null,
      file,
    });
  } catch (err) {
    const message = err instanceof UploadError ? err.message : "We couldn't send that file just now. Please try again.";
    redirectWithFlash(redirectBase, "error", message);
  }

  redirectWithFlash(redirectBase, "ok", "Sent. Your team will see it within a few minutes.");
}
