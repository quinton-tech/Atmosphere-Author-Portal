import "server-only";
import { requireUser, effectiveUserId } from "@/lib/session";
import { getDriveFileForUser } from "@/lib/data/files";
import { getDriveReader } from "@/lib/drive/client";

export const runtime = "nodejs";

/**
 * Same ownership check as `/api/files/d/[fileId]`, returning the file's thumbnail image bytes
 * (fetched server-side from Drive's `thumbnailLink`, which itself requires a credentialed
 * request). 404 whether the file id is unknown, not in this author's folder, or has no thumbnail.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const user = await requireUser();
  const found = await getDriveFileForUser(effectiveUserId(user), fileId);
  if (!found) return new Response(null, { status: 404 });

  let thumb: Awaited<ReturnType<ReturnType<typeof getDriveReader>["thumbnail"]>>;
  try {
    thumb = await getDriveReader().thumbnail(found.file.id);
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
