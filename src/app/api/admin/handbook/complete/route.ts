import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { downloadUploadedFile } from "@/lib/drive/uploads";
import { ingestHandbook } from "@/lib/assistant/handbook";

/**
 * Admin-only counterpart of /api/uploads/complete for the Author Handbook. Once the browser has
 * PUT the file straight to Drive (see .../session/route.ts), this downloads it back server-side
 * with the same drive.file-scoped uploads credential — reading a file that credential just
 * created is within its `drive.file` scope — and hands the bytes to `ingestHandbook`, which
 * parses, splits into sections, persists a new (inactive) handbook version, and audits
 * "admin.handbook.upload" itself (src/lib/assistant/handbook.ts).
 */
export const runtime = "nodejs";

const schema = z.object({
  driveFileId: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    const bytes = await downloadUploadedFile(parsed.data.driveFileId);
    const version = await ingestHandbook({ name: parsed.data.fileName, bytes }, { uploadedById: admin.id });
    return NextResponse.json({ id: version.id }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
