import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { env, isUploadsConfigured } from "@/lib/env";
import { createResumableSession, ensureFolder } from "@/lib/drive/uploads";
import { sanitizeFilename } from "@/lib/drive/mime";

/**
 * Admin-only counterpart of /api/uploads/session for the Author Handbook (see
 * src/app/admin/handbook). Same direct-to-Drive resumable protocol, into a portal-owned
 * "Handbook" subfolder under the uploads root, so a 25MB PDF/DOCX never has to pass through a
 * Vercel function (4.5MB cap: https://vercel.com/docs/functions/limitations#request-body-size).
 * When uploads aren't configured, /admin/handbook falls back to the small server-action form
 * capped at 4MB instead of calling this route — see src/app/admin/handbook/actions.ts.
 */
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  await requireAdmin();

  if (!isUploadsConfigured() || !env.GOOGLE_UPLOADS_ROOT_FOLDER_ID) {
    return NextResponse.json({ error: "Uploads aren't configured. See docs/DEPLOY.md." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { fileName, mimeType, sizeBytes } = parsed.data;

  if (sizeBytes > MAX_BYTES) return NextResponse.json({ error: "File is larger than 25MB." }, { status: 400 });
  if (!ALLOWED_TYPES.has(mimeType) && !/\.(pdf|docx)$/i.test(fileName)) {
    return NextResponse.json({ error: "Only PDF or DOCX files are accepted." }, { status: 400 });
  }

  try {
    const handbookFolderId = await ensureFolder(env.GOOGLE_UPLOADS_ROOT_FOLDER_ID, "Handbook");
    const sessionUri = await createResumableSession({
      folderId: handbookFolderId,
      name: sanitizeFilename(fileName),
      mimeType,
      sizeBytes,
    });
    return NextResponse.json({ sessionUri }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start the upload." }, { status: 502 });
  }
}
