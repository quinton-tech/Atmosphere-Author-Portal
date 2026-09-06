"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, notes } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { redirectWithFlash, runAction } from "../../_lib/flash";
import { linkFolder, setFileVisibility, syncAuthor } from "../../_integrations";
import { getBookRowForAuthor } from "./queries";

const uuid = z.string().uuid();

function detailPath(userId: string, bookId?: string) {
  return `/admin/authors/${userId}${bookId ? `?bookId=${bookId}` : ""}`;
}

/**
 * `userId`/`bookId` pairs here come from hidden form fields bound with `.bind()`, not derived
 * server-side — same shape as an author-facing route accepting a book id, so per CLAUDE.md's
 * "no route may accept a book id without an ownership check" rule this re-derives the pairing
 * from the db (via the same helper the page already uses) rather than trusting the pair as-is.
 */
async function assertBookBelongsToAuthor(userId: string, bookId: string): Promise<void> {
  const row = await getBookRowForAuthor(userId, bookId);
  if (!row) redirectWithFlash(detailPath(userId), "error", "That book doesn't belong to this author.");
}

export async function addNoteAction(userId: string, bookId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const uid = uuid.parse(userId);
  const bid = uuid.parse(bookId);
  await assertBookBelongsToAuthor(uid, bid);
  const parsed = z
    .object({ body: z.string().trim().min(1, "Note can't be empty.").max(4000), visibleToAuthor: z.literal("on").optional() })
    .safeParse({ body: formData.get("body"), visibleToAuthor: formData.get("visibleToAuthor") ?? undefined });
  if (!parsed.success) redirectWithFlash(detailPath(uid, bid), "error", parsed.error.issues[0]?.message ?? "Invalid note.");

  await runAction(
    detailPath(uid, bid),
    async () => {
      await db.insert(notes).values({
        bookId: bid,
        authorId: admin.id,
        body: parsed.data!.body,
        visibleToAuthor: !!parsed.data!.visibleToAuthor,
      });
      await audit(admin.id, "admin.note.create", { targetType: "book", targetId: bid, meta: { visibleToAuthor: !!parsed.data!.visibleToAuthor } });
    },
    "Note added.",
  );
}

export async function refreshFromHubspotAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  const uid = uuid.parse(userId);
  await runAction(
    detailPath(uid),
    async () => {
      await syncAuthor(uid);
      await audit(admin.id, "admin.sync.trigger", { targetType: "user", targetId: uid, meta: { source: "author_refresh" } });
    },
    "Refreshed from HubSpot.",
  );
}

export async function linkFolderAction(userId: string, bookId: string, folderId: string): Promise<void> {
  const admin = await requireAdmin();
  const uid = uuid.parse(userId);
  const bid = uuid.parse(bookId);
  await assertBookBelongsToAuthor(uid, bid);
  await runAction(
    detailPath(uid, bid),
    async () => {
      await linkFolder(bid, folderId);
    },
    "Drive folder linked.",
  );
}

/**
 * Admin override for a book's "Edit your site" link, when the derived `<origin>/wp-admin/` guess
 * (see src/lib/data/books.ts's buildWebsite) is wrong — e.g. a custom admin path or a site not on
 * WordPress. Stored in app_settings.websiteEditOverrides as { [bookId]: url }, never in HubSpot.
 */
export async function setWebsiteEditOverrideAction(userId: string, bookId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const uid = uuid.parse(userId);
  const bid = uuid.parse(bookId);
  await assertBookBelongsToAuthor(uid, bid);

  const raw = String(formData.get("editUrl") ?? "").trim();
  const parsed = z
    .union([z.literal(""), z.string().trim().url().refine((v) => /^https:\/\//i.test(v), "Must be an https URL.")])
    .safeParse(raw);
  if (!parsed.success) redirectWithFlash(detailPath(uid, bid), "error", parsed.error.issues[0]?.message ?? "Invalid URL.");

  await runAction(
    detailPath(uid, bid),
    async () => {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "websiteEditOverrides")).limit(1);
      const current = (row?.value as Record<string, string> | undefined) ?? {};
      const next = { ...current };
      if (parsed.data) next[bid] = parsed.data;
      else delete next[bid];

      await db
        .insert(appSettings)
        .values({ key: "websiteEditOverrides", value: next, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });

      await audit(admin.id, "admin.book.website_override", { targetType: "book", targetId: bid, meta: { editUrl: parsed.data || null } });
    },
    "Website edit URL updated.",
  );
}

export async function setFileVisibilityAction(userId: string, bookId: string, driveFileId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const uid = uuid.parse(userId);
  const bid = uuid.parse(bookId);
  await assertBookBelongsToAuthor(uid, bid);
  const parsed = z
    .object({
      visible: z.literal("on").optional(),
      label: z.string().trim().min(1).max(200),
      category: z.string().trim().min(1).max(100),
    })
    .safeParse({
      visible: formData.get("visible") ?? undefined,
      label: formData.get("label"),
      category: formData.get("category"),
    });
  if (!parsed.success) redirectWithFlash(detailPath(uid, bid), "error", parsed.error.issues[0]?.message ?? "Invalid file settings.");

  await runAction(
    detailPath(uid, bid),
    async () => {
      await setFileVisibility(bid, driveFileId, {
        visible: !!parsed.data!.visible,
        label: parsed.data!.label,
        category: parsed.data!.category,
      });
    },
    "File visibility updated.",
  );
}
