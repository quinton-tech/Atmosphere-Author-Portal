"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stageMilestones, type MilestoneIncludeRule, type MilestoneRuleOperator } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { MilestoneView } from "@/lib/types";
import { redirectWithFlash, runAction } from "../_lib/flash";
import { previewMilestonesForEmail } from "./queries";

const LIST_PATH = "/admin/milestones";

const kindEnum = z.enum(["status", "date", "flag"]);
const ruleOperatorEnum = z.enum(["eq", "neq", "in", "not_in", "empty", "not_empty", "contains"]);

const milestoneSchema = z.object({
  id: z.string().uuid().optional(),
  stageKey: z.string().trim().min(1, "Stage is required."),
  label: z.string().trim().min(1, "Label is required.").max(200),
  description: z.string().trim().max(2000).optional().default(""),
  propertyName: z.string().trim().min(1, "Property name is required."),
  kind: kindEnum,
  linkProperty: z.string().trim().max(200).optional().default(""),
  dateProperty: z.string().trim().max(200).optional().default(""),
  venueProperty: z.string().trim().max(200).optional().default(""),
  linkLabel: z.string().trim().max(200).optional().default(""),
  enabled: z.literal("on").optional(),
  sortOrder: z.coerce.number().int().default(0),
  rulePropertyName: z.string().trim().max(200).optional().default(""),
  ruleOperator: z.union([ruleOperatorEnum, z.literal("")]).optional().default(""),
  ruleValue: z.string().trim().optional().default(""),
});

function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildIncludeRule(formData: FormData, d: z.infer<typeof milestoneSchema>): MilestoneIncludeRule {
  const packages = formData.getAll("packages").map(String).filter(Boolean);
  const addOns = formData.getAll("addOns").map(String).filter(Boolean);

  let property: { name: string; operator: MilestoneRuleOperator; value?: string | string[] } | undefined;
  if (d.rulePropertyName && d.ruleOperator) {
    const op = d.ruleOperator as MilestoneRuleOperator;
    const value =
      op === "empty" || op === "not_empty"
        ? undefined
        : op === "in" || op === "not_in" || op === "contains"
          ? parseList(d.ruleValue)
          : d.ruleValue;
    property = { name: d.rulePropertyName, operator: op, value };
  }

  if (packages.length === 0 && addOns.length === 0 && !property) return null;
  return {
    ...(packages.length ? { packages } : {}),
    ...(addOns.length ? { addOns } : {}),
    ...(property ? { property } : {}),
  };
}

export async function upsertMilestoneAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = milestoneSchema.safeParse({
    id: formData.get("id") || undefined,
    stageKey: formData.get("stageKey"),
    label: formData.get("label"),
    description: formData.get("description"),
    propertyName: formData.get("propertyName"),
    kind: formData.get("kind"),
    linkProperty: formData.get("linkProperty") || "",
    dateProperty: formData.get("dateProperty") || "",
    venueProperty: formData.get("venueProperty") || "",
    linkLabel: formData.get("linkLabel") || "",
    enabled: formData.get("enabled") ?? undefined,
    sortOrder: formData.get("sortOrder"),
    rulePropertyName: formData.get("rulePropertyName") || "",
    ruleOperator: formData.get("ruleOperator") || "",
    ruleValue: formData.get("ruleValue") ?? "",
  });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid milestone.");

  await runAction(
    LIST_PATH,
    async () => {
      const d = parsed.data!;
      const doneValues = parseList(formData.get("doneValues"));
      const hiddenValues = parseList(formData.get("hiddenValues"));
      const inProgressRaw = String(formData.get("inProgressValues") ?? "").trim();
      const inProgressValues = inProgressRaw ? parseList(formData.get("inProgressValues")) : null;
      const includeRule = buildIncludeRule(formData, d);

      const values = {
        stageKey: d.stageKey,
        label: d.label,
        description: d.description ?? "",
        propertyName: d.propertyName,
        kind: d.kind,
        doneValues,
        hiddenValues,
        inProgressValues,
        linkProperty: d.linkProperty || null,
        dateProperty: d.dateProperty || null,
        venueProperty: d.venueProperty || null,
        linkLabel: d.linkLabel || null,
        includeRule,
        sortOrder: d.sortOrder,
        enabled: !!d.enabled,
        updatedAt: new Date(),
      };

      if (d.id) {
        await db.update(stageMilestones).set(values).where(eq(stageMilestones.id, d.id));
      } else {
        await db.insert(stageMilestones).values(values);
      }
      await audit(admin.id, "admin.milestone.update", {
        targetType: "stage_milestone",
        targetId: d.id ?? "new",
        meta: { action: d.id ? "update" : "create" },
      });
    },
    "Milestone saved.",
  );
}

export async function deleteMilestoneAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const milestoneId = z.string().uuid().parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      await db.delete(stageMilestones).where(eq(stageMilestones.id, milestoneId));
      await audit(admin.id, "admin.milestone.update", { targetType: "stage_milestone", targetId: milestoneId, meta: { action: "delete" } });
    },
    "Milestone deleted.",
  );
}

export type PreviewState = { email?: string; bookTitle?: string; milestones?: MilestoneView[]; error?: string };

export async function previewMilestoneAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an author email." };
  const result = await previewMilestonesForEmail(email);
  if ("error" in result) return { email, error: result.error };
  return { email, bookTitle: result.bookTitle, milestones: result.milestones };
}
