import "server-only";
import type { NextRequest } from "next/server";
import { requireUser, effectiveUserId } from "@/lib/session";
import { getVisibleFileForUser } from "@/lib/data/books";
import { getDriveReader } from "@/lib/drive/client";
import { contentDisposition } from "@/lib/drive/mime";

export const runtime = "nodejs";

/**
 * Streams one Drive file's bytes through the portal after an ownership check. Never links
 * directly to Drive. Returns 404 (never 403) whether the file id is unknown, belongs to another
 * author's book, or the underlying Drive object is gone — so the response never confirms which.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const row = await getVisibleFileForUser(effectiveUserId(user), id);
  if (!row) return new Response(null, { status: 404 });

  let file: Awaited<ReturnType<ReturnType<typeof getDriveReader>["stream"]>>;
  try {
    file = await getDriveReader().stream(row.file.driveFileId);
  } catch {
    return new Response(null, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const headers = new Headers({
    "Content-Type": file.mimeType,
    "Content-Disposition": contentDisposition(download ? "attachment" : "inline", row.file.label, file.mimeType),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (file.size != null) headers.set("Content-Length", String(file.size));

  return new Response(file.stream, { status: 200, headers });
}
