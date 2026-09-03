"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { runAction } from "../_lib/flash";
import { ingestHandbook, activateHandbook, askAssistant } from "../_integrations";

const LIST_PATH = "/admin/handbook";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type UploadState = { error?: string; ok?: string };

export async function uploadHandbookAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const admin = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or DOCX file." };
  if (file.size > MAX_BYTES) return { error: "File is larger than 25MB." };
  if (file.type && !ALLOWED_TYPES.has(file.type) && !/\.(pdf|docx)$/i.test(file.name)) {
    return { error: "Only PDF or DOCX files are accepted." };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const version = await ingestHandbook({ name: file.name, bytes });
    await audit(admin.id, "admin.handbook.upload", { targetType: "handbook_version", targetId: version.id, meta: { filename: file.name } });
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
