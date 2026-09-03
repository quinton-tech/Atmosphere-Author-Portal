import "server-only";
import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "auth.login"
  | "auth.password_set"
  | "auth.password_reset"
  | "auth.totp_enabled"
  | "author.contact_info.update"
  | "author.contact_info.failed"
  | "admin.invite"
  | "admin.resend_invite"
  | "admin.revoke_access"
  | "admin.force_signout"
  | "admin.view_as"
  | "admin.stop_view_as"
  | "admin.stage_config.update"
  | "admin.action_rule.update"
  | "admin.property_display.update"
  | "admin.book.link_folder"
  | "admin.file.visibility"
  | "admin.note.create"
  | "admin.handbook.upload"
  | "admin.handbook.activate"
  | "admin.assistant.settings"
  | "admin.sync.trigger";

export async function audit(
  actorId: string | null,
  action: AuditAction,
  opts: { targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {},
) {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    // outside a request (cron/script)
  }
  await db.insert(auditLog).values({
    actorId,
    action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    meta: opts.meta ?? {},
    ip,
  });
}
