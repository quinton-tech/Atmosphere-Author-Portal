"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { actionRules } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { ActionItem } from "@/lib/types";
import { redirectWithFlash, runAction } from "../_lib/flash";
import { previewRulesForBook, type PreviewBookOption, type RulePreviewDetail } from "./queries";

const LIST_PATH = "/admin/rules";

const operatorEnum = z.enum(["eq", "neq", "in", "not_in", "empty", "not_empty"]);

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  propertyName: z.string().trim().min(1, "Property name is required."),
  operator: operatorEnum,
  value: z.string().trim().optional().default(""),
  title: z.string().trim().min(1, "Title is required.").max(200),
  message: z.string().trim().max(2000).optional().default(""),
  ctaLabel: z.string().trim().max(100).optional(),
  ctaUrl: z.string().trim().url().optional().or(z.literal("")),
  severity: z.enum(["action", "info"]).default("action"),
  enabled: z.literal("on").optional(),
  sortOrder: z.coerce.number().int().default(0),
});

function toRuleValue(operator: z.infer<typeof operatorEnum>, raw: string): string | string[] | null {
  if (operator === "empty" || operator === "not_empty") return null;
  if (operator === "in" || operator === "not_in") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return raw;
}

export async function upsertRuleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = ruleSchema.safeParse({
    id: formData.get("id") || undefined,
    propertyName: formData.get("propertyName"),
    operator: formData.get("operator"),
    value: formData.get("value") ?? "",
    title: formData.get("title"),
    message: formData.get("message"),
    ctaLabel: formData.get("ctaLabel") || undefined,
    ctaUrl: formData.get("ctaUrl") || "",
    severity: formData.get("severity"),
    enabled: formData.get("enabled") ?? undefined,
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid rule.");

  await runAction(
    LIST_PATH,
    async () => {
      const d = parsed.data!;
      const values = {
        propertyName: d.propertyName,
        operator: d.operator,
        value: toRuleValue(d.operator, d.value ?? ""),
        title: d.title,
        message: d.message ?? "",
        ctaLabel: d.ctaLabel || null,
        ctaUrl: d.ctaUrl || null,
        severity: d.severity,
        enabled: !!d.enabled,
        sortOrder: d.sortOrder,
        updatedAt: new Date(),
      };
      if (d.id) {
        await db.update(actionRules).set(values).where(eq(actionRules.id, d.id));
      } else {
        await db.insert(actionRules).values(values);
      }
      await audit(admin.id, "admin.action_rule.update", {
        targetType: "action_rule",
        targetId: d.id ?? "new",
        meta: { action: d.id ? "update" : "create" },
      });
    },
    "Rule saved.",
  );
}

export async function deleteRuleAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  const ruleId = z.string().uuid().parse(id);
  await runAction(
    LIST_PATH,
    async () => {
      await db.delete(actionRules).where(eq(actionRules.id, ruleId));
      await audit(admin.id, "admin.action_rule.update", { targetType: "action_rule", targetId: ruleId, meta: { action: "delete" } });
    },
    "Rule deleted.",
  );
}

export type PreviewState = {
  email?: string;
  bookId?: string;
  bookTitle?: string;
  books?: PreviewBookOption[];
  actions?: ActionItem[];
  details?: RulePreviewDetail[];
  error?: string;
};

export async function previewRuleAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an author email." };
  const bookId = String(formData.get("bookId") ?? "").trim() || undefined;
  const result = await previewRulesForBook(email, bookId);
  if ("error" in result) return { email, error: result.error };
  return { email, bookId: result.bookId, bookTitle: result.bookTitle, books: result.books, actions: result.actions, details: result.details };
}
