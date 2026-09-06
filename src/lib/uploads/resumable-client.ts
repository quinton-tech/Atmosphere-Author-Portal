/**
 * Browser-only driver for a Google Drive resumable upload session. Only ever called from a
 * "use client" component (UploadFormClient.tsx) after the server has already created the session
 * via `POST /api/uploads/session` (see `src/lib/drive/uploads.ts#createResumableSession`) — the
 * bytes below go straight from this browser to `sessionUri` on googleapis.com; they never pass
 * through our own server, which is the whole point of this flow (Vercel functions cap request
 * bodies at 4.5MB: https://vercel.com/docs/functions/limitations#request-body-size).
 *
 * No "use client" directive needed here — it's a plain module with no React/JSX, and it only ever
 * *runs* in the browser because its sole caller is a Client Component's event handler.
 */
import { parseDriveFileId, parseResumeOffset, resumeContentRange, statusCheckContentRange } from "./resumable";

type XhrResult = { status: number; responseText: string; range: string | null };

function xhrPut(url: string, body: Blob | null, headers: Record<string, string>, onProgress?: (loaded: number) => void): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded);
      };
    }
    xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("A network error interrupted the upload."));
    xhr.send(body);
  });
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Uploads `file` directly to Google's resumable session URI. One PUT of the whole file with
 * upload-progress events; if that PUT throws (network drop) or comes back with a non-2xx status,
 * does exactly one recovery round: ask Drive how many bytes it already has
 * (`Content-Range: bytes *\/total`, Google's documented status-check request) and PUT only the
 * remainder from that offset. This is the "simple retry" the brief asks for — not a general
 * chunked uploader. Resolves with the new file's Drive id, read from the final PUT's JSON body.
 */
export async function uploadFileResumable(sessionUri: string, file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const putFrom = (offset: number): Promise<XhrResult> => {
    const body = offset > 0 ? file.slice(offset) : file;
    const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
    if (offset > 0) headers["Content-Range"] = resumeContentRange(offset, file.size);
    return xhrPut(sessionUri, body, headers, (loaded) => onProgress?.(file.size === 0 ? 1 : (offset + loaded) / file.size));
  };

  let first: XhrResult | null = null;
  try {
    first = await putFrom(0);
    if (isSuccess(first.status)) {
      const id = parseDriveFileId(first.responseText);
      if (id) return id;
    }
  } catch {
    // Network error — fall through to the recovery round below.
  }

  const statusCheck = await xhrPut(sessionUri, null, { "Content-Range": statusCheckContentRange(file.size) });
  if (isSuccess(statusCheck.status)) {
    const id = parseDriveFileId(statusCheck.responseText);
    if (id) return id;
  }

  const offset = parseResumeOffset(statusCheck.range);
  const resumed = await putFrom(offset);
  const id = parseDriveFileId(resumed.responseText);
  if (isSuccess(resumed.status) && id) return id;

  throw new Error("The upload didn't complete. Please try again.");
}
