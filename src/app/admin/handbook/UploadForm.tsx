"use client";

import { useActionState } from "react";
import { uploadHandbookAction, type UploadState } from "./actions";
import { FormError, FormSuccess, PillButton } from "../_components/ui";

const initial: UploadState = {};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadHandbookAction, initial);
  return (
    <form action={formAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="eyebrow">
          Upload handbook (PDF or DOCX, ≤ 25MB)
        </label>
        <input id="file" name="file" type="file" accept=".pdf,.docx" required className="text-sm" />
      </div>
      <PillButton variant="solid">{pending ? "Uploading…" : "Upload"}</PillButton>
      <div className="basis-full">
        <FormError message={state.error} />
        <FormSuccess message={state.ok} />
      </div>
    </form>
  );
}
