"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFileResumable } from "@/lib/uploads/resumable-client";
import { FormError, FormSuccess, PillButton } from "../_components/ui";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

type Phase = "idle" | "starting" | "uploading" | "finishing" | "error";

/**
 * Direct-to-Drive handbook upload (real path, used when GOOGLE_UPLOADS_* is configured — see
 * page.tsx). Same protocol as the author-facing UploadFormClient: POST /api/admin/handbook/session
 * for a resumable session URI, PUT the file straight to Drive from the browser, then POST
 * /api/admin/handbook/complete to have the server read it back and ingest it.
 */
export function UploadFormClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [ok, setOk] = useState<string | undefined>();
  const pending = phase === "starting" || phase === "uploading" || phase === "finishing";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(undefined);
    setOk(undefined);

    const form = e.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF or DOCX file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is larger than 25MB.");
      return;
    }
    if (file.type && !ALLOWED_TYPES.has(file.type) && !/\.(pdf|docx)$/i.test(file.name)) {
      setError("Only PDF or DOCX files are accepted.");
      return;
    }

    setPhase("starting");
    setProgress(0);
    try {
      const sessionRes = await fetch("/api/admin/handbook/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      const sessionBody = (await sessionRes.json().catch(() => ({}))) as { sessionUri?: string; error?: string };
      if (!sessionRes.ok || !sessionBody.sessionUri) throw new Error(sessionBody.error || "Could not start the upload.");

      setPhase("uploading");
      const driveFileId = await uploadFileResumable(sessionBody.sessionUri, file, (fraction) => setProgress(Math.round(fraction * 100)));

      setPhase("finishing");
      const completeRes = await fetch("/api/admin/handbook/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFileId, fileName: file.name }),
      });
      const completeBody = (await completeRes.json().catch(() => ({}))) as { error?: string };
      if (!completeRes.ok) throw new Error(completeBody.error || "Upload failed.");

      setOk(`Uploaded ${file.name}.`);
      form.reset();
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="eyebrow">
          Upload handbook (PDF or DOCX, ≤ 25MB)
        </label>
        <input ref={fileRef} id="file" name="file" type="file" accept=".pdf,.docx" required disabled={pending} className="text-sm" />
      </div>
      <PillButton variant="solid">{phase === "uploading" ? `Uploading… ${progress}%` : pending ? "Uploading…" : "Upload"}</PillButton>
      <div className="basis-full">
        <FormError message={error} />
        <FormSuccess message={ok} />
      </div>
    </form>
  );
}
