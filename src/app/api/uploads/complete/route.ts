import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveUserId, requireUser } from "@/lib/session";
import { completeUploadForUser, UploadError } from "@/lib/data/uploads";

/**
 * Step 2 of the direct-to-Drive upload protocol: called once the browser's PUT to the resumable
 * session URI (from /api/uploads/session) has finished. `driveFileId` is whatever the browser
 * read out of that PUT's JSON response body — this route re-confirms it with Drive itself
 * (src/lib/drive/uploads.ts#finalizeUploadedFile) rather than trusting the client.
 */
export const runtime = "nodejs";

const completeSchema = z.object({
  uploadId: z.string().uuid(),
  driveFileId: z.string().trim().min(1).max(200).optional().nullable(),
});

export async function POST(request: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const row = await completeUploadForUser(effectiveUserId(user), {
      uploadId: parsed.data.uploadId,
      driveFileId: parsed.data.driveFileId,
    });
    return NextResponse.json({ status: row.status }, { status: 200 });
  } catch (err) {
    const message = err instanceof UploadError ? err.message : "We couldn't confirm that upload just now. Please try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
