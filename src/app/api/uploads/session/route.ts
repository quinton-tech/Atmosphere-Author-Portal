import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveUserId, requireUser } from "@/lib/session";
import { createUploadSessionForUser, UploadError, UPLOAD_KINDS } from "@/lib/data/uploads";

/**
 * Step 1 of the direct-to-Drive upload protocol (see src/lib/data/uploads.ts). Runs every
 * validation up front and returns a Google resumable session URI for the browser to PUT the file
 * to directly — this route never receives the file's bytes, only its metadata, so it stays well
 * under Vercel's 4.5MB function body cap regardless of the 50MB upload limit we advertise
 * (https://vercel.com/docs/functions/limitations#request-body-size).
 */
export const runtime = "nodejs";

const sessionSchema = z.object({
  bookId: z.string().uuid().optional().nullable(),
  kind: z.enum(UPLOAD_KINDS),
  note: z.string().trim().max(2000).optional().nullable(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the highlighted fields and try again." }, { status: 400 });
  }

  try {
    const result = await createUploadSessionForUser(effectiveUserId(user), {
      bookId: parsed.data.bookId || null,
      kind: parsed.data.kind,
      note: parsed.data.note || null,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof UploadError ? err.message : "We couldn't start that upload just now. Please try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
