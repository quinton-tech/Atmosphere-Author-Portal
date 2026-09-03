import "server-only";
import { requireUser, effectiveUserId } from "@/lib/session";
import { getVisibleFileForUser } from "@/lib/data/books";
import { getDriveReader } from "@/lib/drive/client";

export const runtime = "nodejs";

/**
 * Same ownership check as `/api/files/[id]`, returning the file's thumbnail image bytes
 * (fetched server-side from Drive's `thumbnailLink`, which itself requires a credentialed
 * request). 404 whether the file id is unknown, not owned by this author, or has no thumbnail.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const row = await getVisibleFileForUser(effectiveUserId(user), id);
  if (!row) return new Response(null, { status: 404 });

  let thumb: Awaited<ReturnType<ReturnType<typeof getDriveReader>["thumbnail"]>>;
  try {
    thumb = await getDriveReader().thumbnail(row.file.driveFileId);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!thumb) return new Response(null, { status: 404 });

  const headers = new Headers({
    "Content-Type": thumb.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=86400",
  });

  const body = thumb.bytes.buffer.slice(thumb.bytes.byteOffset, thumb.bytes.byteOffset + thumb.bytes.byteLength) as ArrayBuffer;
  return new Response(body, { status: 200, headers });
}
