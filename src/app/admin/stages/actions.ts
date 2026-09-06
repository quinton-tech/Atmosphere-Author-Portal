"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stageConfig } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { redirectWithFlash, runAction } from "../_lib/flash";

const LIST_PATH = "/admin/stages";

function parseHubspotValues(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const stageSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "Key must be lowercase letters, numbers, and underscores."),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  sortOrder: z.coerce.number().int().default(0),
  typicalWeeks: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  isTerminal: z.literal("on").optional(),
  kind: z.enum(["pipeline", "derived"]).default("pipeline"),
  parentStageKey: z.string().trim().max(64).optional().default(""),
  showWhenEmpty: z.literal("on").optional(),
});

export async function upsertStageAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = stageSchema.safeParse({
    key: formData.get("key"),
    label: formData.get("label"),
    description: formData.get("description"),
    sortOrder: formData.get("sortOrder"),
    typicalWeeks: formData.get("typicalWeeks") || "",
    isTerminal: formData.get("isTerminal") ?? undefined,
    kind: formData.get("kind") || "pipeline",
    parentStageKey: formData.get("parentStageKey") || "",
    showWhenEmpty: formData.get("showWhenEmpty") ?? undefined,
  });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid stage.");

  await runAction(
    LIST_PATH,
    async () => {
      const d = parsed.data!;
      const isDerived = d.kind === "derived";
      // A pipeline row's HubSpot mapping; a derived row's driving milestones. Never both — the
      // other column keeps its default/empty value for the row's actual kind.
      const hubspotValues = isDerived ? [] : parseHubspotValues(formData.get("hubspotValues"));
      const derivedMilestoneIds = isDerived ? formData.getAll("derivedMilestoneIds").map(String).filter(Boolean) : [];
      const parentStageKey = isDerived && d.parentStageKey ? d.parentStageKey : null;
      const typicalWeeks = d.typicalWeeks === "" || d.typicalWeeks == null ? null : Number(d.typicalWeeks);
      const existing = await db.select().from(stageConfig).where(eq(stageConfig.key, d.key)).limit(1);
      await db
        .insert(stageConfig)
        .values({
          key: d.key,
          label: d.label,
          description: d.description ?? "",
          hubspotValues,
          sortOrder: d.sortOrder,
          typicalWeeks,
          isTerminal: !!d.isTerminal,
          kind: d.kind,
          derivedMilestoneIds,
          parentStageKey,
          showWhenEmpty: !isDerived || !!d.showWhenEmpty,
        })
        .onConflictDoUpdate({
          target: stageConfig.key,
          set: {
            label: d.label,
            description: d.description ?? "",
            hubspotValues,
            sortOrder: d.sortOrder,
            typicalWeeks,
            isTerminal: !!d.isTerminal,
            kind: d.kind,
            derivedMilestoneIds,
            parentStageKey,
            showWhenEmpty: !isDerived || !!d.showWhenEmpty,
            updatedAt: new Date(),
          },
        });
      await audit(admin.id, "admin.stage_config.update", {
        targetType: "stage_config",
        targetId: d.key,
        meta: { action: existing.length ? "update" : "create" },
      });
    },
    "Stage saved.",
  );
}

export async function deleteStageAction(key: string): Promise<void> {
  const admin = await requireAdmin();
  const k = z.string().min(1).parse(key);
  await runAction(
    LIST_PATH,
    async () => {
      await db.delete(stageConfig).where(eq(stageConfig.key, k));
      await audit(admin.id, "admin.stage_config.update", { targetType: "stage_config", targetId: k, meta: { action: "delete" } });
    },
    "Stage deleted.",
  );
}
