import "server-only";

/**
 * Thin adapter between the admin UI and the library modules. It exists so the admin
 * pages don't need to know about audit actor ids or minor signature differences.
 * Every mutating call here is preceded by requireAdmin() in the calling server action.
 */
import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { db } from "@/db";
import { handbookVersions, visibleFiles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import * as drive from "@/lib/drive/admin";
import { getDriveReader as realGetDriveReader, type DriveFile } from "@/lib/drive/client";
import * as handbook from "@/lib/assistant/handbook";
import { getActiveModel as realGetActiveModel, listAvailableModels as realListAvailableModels } from "@/lib/assistant/providers";
import { buildPrompt } from "@/lib/assistant/prompt";
import { parseCitations } from "@/lib/assistant/citations";

export { inviteAuthor, resendInvite, revokeAccess, forceSignOut } from "@/lib/auth/invite";
export { syncAuthor, runIncrementalSync, runFullSync } from "@/lib/hubspot/sync";
export type { DriveFile };
export type AdminDriveFile = drive.AdminDriveFile;

export function getDriveReader() {
  return realGetDriveReader();
}

/** Admin UI calls (folderId, bookId); the library takes (bookId, folderId). */
export async function listFolderForAdmin(folderId: string, bookId: string): Promise<AdminDriveFile[]> {
  return drive.listFolderForAdmin(bookId, folderId);
}

export async function setFileVisibility(
  bookId: string,
  driveFileId: string,
  opts: { visible: boolean; label: string; category: string; mimeType?: string | null },
): Promise<void> {
  const admin = await requireAdmin();
  return drive.setFileVisibility(bookId, driveFileId, opts, admin.id);
}

export async function linkFolder(bookId: string, folderId: string): Promise<void> {
  const admin = await requireAdmin();
  return drive.linkFolder(bookId, folderId, admin.id);
}

export type FileOverrideInput = {
  /** Staff override: hide this file from the author even though it's in their Drive folder. */
  hidden: boolean;
  /** Empty string means "no label override, use the Drive name". */
  label: string;
  /** Empty string means "no category override, use the inferred one". */
  category: string;
  mimeType?: string | null;
};

/**
 * Upserts (or clears) the `visible_files` override row for one Drive file on one book.
 * `visible_files` is an *overrides* table now (see CLAUDE.md's Drive model, `hidden` column on
 * `src/db/schema.ts`) — authors see their whole Drive folder by default, and a row here only
 * exists to hide a file or relabel/recategorize it. When there's no hide flag and no label/category
 * override, the row is deleted so a plain "shown as-is" file doesn't need one at all.
 *
 * Writes directly against `visible_files` (rather than going through `src/lib/drive/admin.ts`'s
 * `setFileVisibility`, which still speaks the old opt-in "visible" polarity — another agent may
 * be updating that file for the new model) so this admin UI isn't blocked on that change landing.
 */
export async function upsertFileOverride(bookId: string, driveFileId: string, input: FileOverrideInput): Promise<void> {
  const admin = await requireAdmin();

  const label = input.label.trim();
  const category = input.category.trim();
  const hasOverride = input.hidden || label.length > 0 || category.length > 0;

  const [existing] = await db
    .select()
    .from(visibleFiles)
    .where(and(eq(visibleFiles.bookId, bookId), eq(visibleFiles.driveFileId, driveFileId)))
    .limit(1);

  if (!hasOverride) {
    if (existing) await db.delete(visibleFiles).where(eq(visibleFiles.id, existing.id));
  } else if (existing) {
    await db
      .update(visibleFiles)
      .set({
        hidden: input.hidden,
        label: label || existing.label,
        category: category || existing.category,
        mimeType: input.mimeType ?? existing.mimeType,
      })
      .where(eq(visibleFiles.id, existing.id));
  } else {
    await db.insert(visibleFiles).values({
      bookId,
      driveFileId,
      hidden: input.hidden,
      label: label || "Untitled file",
      category: category || "Other",
      mimeType: input.mimeType ?? null,
      createdById: admin.id,
    });
  }

  await audit(admin.id, "admin.file.visibility", {
    targetType: "book",
    targetId: bookId,
    meta: { driveFileId, hidden: input.hidden, label: label || null, category: category || null },
  });
}

export async function ingestHandbook(file: { name: string; bytes: Uint8Array }): Promise<{ id: string }> {
  const admin = await requireAdmin();
  return handbook.ingestHandbook(file, { uploadedById: admin.id });
}

export async function activateHandbook(id: string): Promise<void> {
  const admin = await requireAdmin();
  return handbook.activateHandbook(id, admin.id);
}

export type ModelOption = {
  provider: "anthropic" | "openai" | "google";
  modelId: string;
  displayName: string;
  inputPrice?: number;
  outputPrice?: number;
};

export async function listAvailableModels(): Promise<ModelOption[]> {
  return realListAvailableModels().map((m) => ({
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    inputPrice: m.inputPricePerMTok,
    outputPrice: m.outputPricePerMTok,
  }));
}

export async function getActiveModel(): Promise<{ provider: string; modelId: string } | null> {
  const a = await realGetActiveModel();
  return a ? { provider: a.provider, modelId: a.modelId } : null;
}

/** "Test a question" on /admin/handbook: one non-streamed answer against a chosen handbook version. */
export async function askAssistant(input: { question: string; handbookVersionId: string }): Promise<{
  answer: string;
  citations: { sectionId: string; heading: string }[];
}> {
  await requireAdmin();
  const active = await realGetActiveModel();
  if (!active) throw new Error("No assistant model is configured. Pick one under Assistant first.");
  const [version] = await db.select().from(handbookVersions).where(eq(handbookVersions.id, input.handbookVersionId)).limit(1);
  if (!version) throw new Error("That handbook version no longer exists.");

  const { instructions, messages } = buildPrompt({
    provider: active.provider,
    handbookSections: version.sections,
    history: [],
    question: input.question,
  });
  const result = await generateText({ model: active.model, instructions, messages });
  const parsed = parseCitations(result.text, version.sections);
  return { answer: parsed.answer, citations: parsed.citations.map((c) => ({ sectionId: c.sectionId, heading: c.heading })) };
}
