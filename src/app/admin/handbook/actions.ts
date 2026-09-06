"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { runAction } from "../_lib/flash";
import { ingestHandbook, activateHandbook, askAssistant } from "../_integrations";

const LIST_PATH = "/admin/handbook";
// This is the FALLBACK path only, used when GOOGLE_UPLOADS_* isn't configured (see page.tsx) —
// the whole file still goes through this server action's request body, so it's capped at
// Vercel's hard function limit (4.5MB: https://vercel.com/docs/functions/limitations#request-body-size)
// rather than the real 25MB limit, which needs the direct-to-Drive resumable flow
// (UploadFormClient.tsx, /api/admin/handbook/session + /complete) to actually work.
const FALLBACK_MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type UploadState = { error?: string; ok?: string };

export async function uploadHandbookAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or DOCX file." };
  if (file.size > FALLBACK_MAX_BYTES) {
    return { error: "File is larger than 4MB. Larger files need the uploads service account configured — see docs/DEPLOY.md." };
  }
  if (file.type && !ALLOWED_TYPES.has(file.type) && !/\.(pdf|docx)$/i.test(file.name)) {
    return { error: "Only PDF or DOCX files are accepted." };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // ingestHandbook (src/lib/assistant/handbook.ts) already audits "admin.handbook.upload"
    // itself, so there's no separate audit() call needed here.
    await ingestHandbook({ name: file.name, bytes });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
  return { ok: `Uploaded ${file.name}.` };
}

export async function activateHandbookAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const versionId = z.string().uuid().parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      await activateHandbook(versionId);
      await audit(admin.id, "admin.handbook.activate", { targetType: "handbook_version", targetId: versionId });
    },
    "Active version updated.",
  );
}

export type TestQuestionState = { question?: string; answer?: string; citations?: { sectionId: string; heading: string }[]; error?: string };

export async function testQuestionAction(_prev: TestQuestionState, formData: FormData): Promise<TestQuestionState> {
  await requireAdmin();
  const question = String(formData.get("question") ?? "").trim();
  const handbookVersionId = String(formData.get("handbookVersionId") ?? "").trim();
  if (!question) return { error: "Enter a question." };
  if (!handbookVersionId) return { error: "Choose a handbook version." };
  try {
    const result = await askAssistant({ question, handbookVersionId });
    return { question, answer: result.answer, citations: result.citations };
  } catch (e) {
    return { question, error: e instanceof Error ? e.message : "Could not run the test question." };
  }
}
