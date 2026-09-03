"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { propertyDisplay } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit, type AuditAction } from "@/lib/audit";
import { redirectWithFlash, runAction } from "../_lib/flash";

const LIST_PATH = "/admin/labels";

// TODO(lead): src/lib/audit.ts is off-limits to this agent. Add
// "admin.property_display.update" to the AuditAction union and drop this cast.
const PROPERTY_DISPLAY_UPDATE: AuditAction = "admin.property_display.update";

const labelSchema = z.object({
  propertyId: z.string().trim().min(1),
  rawValue: z.string().trim().min(1),
  label: z.string().trim().min(1, "Label is required.").max(200),
  description: z.string().trim().max(1000).optional().default(""),
});

export async function upsertLabelAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = labelSchema.safeParse({
    propertyId: formData.get("propertyId"),
    rawValue: formData.get("rawValue"),
    label: formData.get("label"),
    description: formData.get("description"),
  });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid label.");

  await runAction(
    LIST_PATH,
    async () => {
      await db
        .insert(propertyDisplay)
        .values({ ...parsed.data! })
        .onConflictDoUpdate({
          target: [propertyDisplay.propertyId, propertyDisplay.rawValue],
          set: { label: parsed.data!.label, description: parsed.data!.description ?? "", updatedAt: new Date() },
        });
      await audit(admin.id, PROPERTY_DISPLAY_UPDATE, {
        targetType: "property_display",
        targetId: `${parsed.data!.propertyId}:${parsed.data!.rawValue}`,
        meta: { action: "upsert" },
      });
    },
    "Label saved.",
  );
}

export async function deleteLabelAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const parsedId = z.string().uuid().parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      await db.delete(propertyDisplay).where(eq(propertyDisplay.id, parsedId));
      await audit(admin.id, PROPERTY_DISPLAY_UPDATE, { targetType: "property_display", targetId: parsedId, meta: { action: "delete" } });
    },
    "Label deleted.",
  );
}
