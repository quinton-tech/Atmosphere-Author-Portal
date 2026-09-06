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

function redirectWithFlash(kind: "ok" | "error", message: string): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`/uploads?${params.toString()}`);
}

export async function uploadFileAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirectWithFlash("error", "Please choose a file to send.");
  }

  const parsed = uploadSchema.safeParse({
    bookId: formData.get("bookId") ?? "",
    kind: formData.get("kind"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    redirectWithFlash("error", "Please check the highlighted fields and try again.");
  }

  try {
    await createUploadForUser(effectiveUserId(user), {
      bookId: parsed.data.bookId || null,
      kind: parsed.data.kind,
      note: parsed.data.note || null,
      file,
    });
  } catch (err) {
    const message = err instanceof UploadError ? err.message : "We couldn't send that file just now. Please try again.";
    redirectWithFlash("error", message);
  }

  redirectWithFlash("ok", "Sent. Your team will see it within a few minutes.");
}
