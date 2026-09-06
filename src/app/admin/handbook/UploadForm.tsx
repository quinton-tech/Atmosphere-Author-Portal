"use client";

import { useActionState } from "react";
import { uploadHandbookAction, type UploadState } from "./actions";
import { FormError, FormSuccess, PillButton } from "../_components/ui";

const initial: UploadState = {};

/**
 * Fallback path only — used by page.tsx when `GOOGLE_UPLOADS_*` isn't configured, so there's no
 * resumable-session route to talk to (see UploadFormClient.tsx for the real, direct-to-Drive
 * flow). The whole file goes through this `<form action>` server action's request body, so it's
 * capped at 4MB (Vercel's hard function limit), not the real 25MB handbook limit.
 */
export function FallbackUploadForm() {
  const [state, formAction, pending] = useActionState(uploadHandbookAction, initial);
  return (
    <form action={formAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="eyebrow">
          Upload handbook (PDF or DOCX, ≤ 4MB)
        </label>
        <input id="file" name="file" type="file" accept=".pdf,.docx" required className="text-sm" />
        <span className="text-xs text-muted">Larger files need the uploads service account configured — see docs/DEPLOY.md.</span>
      </div>
      <PillButton variant="solid">{pending ? "Uploading…" : "Upload"}</PillButton>
      <div className="basis-full">
        <FormError message={state.error} />
        <FormSuccess message={state.ok} />
      </div>
    </form>
  );
}
