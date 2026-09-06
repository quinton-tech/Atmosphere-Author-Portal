"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFileResumable } from "@/lib/uploads/resumable-client";
import { UPLOAD_ACCEPT, UPLOAD_KIND_LABELS } from "@/lib/uploads/shared";

const selectCls = "mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink";

type UploadFormClientProps =
  | { book: { id: string; title: string }; books?: never; defaultBookId?: never }
  | { books: { id: string; title: string }[]; defaultBookId: string | null; book?: never };

type Phase = "idle" | "starting" | "uploading" | "finishing" | "error";

/**
 * Owns the actual send: talks to `POST /api/uploads/session` then (for a real, non-demo upload)
 * PUTs the file straight to the Google resumable session URI it gets back — the bytes never pass
 * through our server, which is what makes files up to 50MB actually work (Vercel functions cap
 * request bodies at 4.5MB: https://vercel.com/docs/functions/limitations#request-body-size).
 * Finally calls `POST /api/uploads/complete` to confirm and record the upload. See
 * `src/lib/data/uploads.ts` for the server-side half of this protocol.
 */
export function UploadFormClient(props: UploadFormClientProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const pending = phase === "starting" || phase === "uploading" || phase === "finishing";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setOk(null);

    const form = e.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a file to send.");
      return;
    }

    const formData = new FormData(form);
    const bookId = String(formData.get("bookId") ?? "").trim();
    const kind = String(formData.get("kind") ?? "manuscript");
    const note = String(formData.get("note") ?? "").trim();

    setPhase("starting");
    setProgress(0);
    try {
      const sessionRes = await fetch("/api/uploads/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: bookId || null,
          kind,
          note: note || null,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      const sessionBody = (await sessionRes.json().catch(() => ({}))) as { uploadId?: string; sessionUri?: string | null; error?: string };
      if (!sessionRes.ok || !sessionBody.uploadId) {
        throw new Error(sessionBody.error || "We couldn't start that upload just now. Please try again.");
      }

      let driveFileId: string | undefined;
      if (sessionBody.sessionUri) {
        setPhase("uploading");
        driveFileId = await uploadFileResumable(sessionBody.sessionUri, file, (fraction) => setProgress(Math.round(fraction * 100)));
      }

      setPhase("finishing");
      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: sessionBody.uploadId, driveFileId }),
      });
      const completeBody = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) throw new Error(completeBody.error || "We couldn't confirm that upload just now. Please try again.");

      setOk("Sent. Your team will see it within a few minutes.");
      form.reset();
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "We couldn't send that file just now. Please try again.");
    }
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-4 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="mb-4 text-sm font-semibold text-teal-ink">
          {ok}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="eyebrow">File</span>
          <input
            ref={fileRef}
            name="file"
            type="file"
            required
            accept={UPLOAD_ACCEPT}
            disabled={pending}
            className="mt-2 block w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-muted">PDF, Word, RTF, TXT, JPG, PNG, or ZIP. Up to 50 MB.</span>
        </label>

        {props.book ? (
          <input type="hidden" name="bookId" value={props.book.id} />
        ) : (
          <label className="block">
            <span className="eyebrow">Book</span>
            <select name="bookId" defaultValue={props.defaultBookId ?? ""} disabled={pending} className={selectCls}>
              <option value="">Not tied to a specific book</option>
              {props.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="eyebrow">What is it?</span>
          <select name="kind" defaultValue="manuscript" disabled={pending} className={selectCls}>
            {Object.entries(UPLOAD_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="eyebrow">Note (optional)</span>
          <textarea
            name="note"
            rows={3}
            disabled={pending}
            placeholder="Anything your team should know about this file"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-ink disabled:opacity-60"
          />
        </label>

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {phase === "uploading" ? `Sending… ${progress}%` : pending ? "Sending…" : "Send to your team"}
          </button>
          {phase === "uploading" ? (
            <div className="h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-line" aria-hidden>
              <div className="h-full bg-teal-ink transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
