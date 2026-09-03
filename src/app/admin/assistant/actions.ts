"use server";

import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { redirectWithFlash, runAction } from "../_lib/flash";

const LIST_PATH = "/admin/assistant";

// The <select> posts a single "provider::modelId" value so the form works without client JS.
const settingsSchema = z.object({
  providerModel: z
    .string()
    .trim()
    .regex(/^(anthropic|openai|google)::.+$/, "Choose a model."),
});

export async function saveAssistantSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse({ providerModel: formData.get("providerModel") });
  if (!parsed.success) redirectWithFlash(LIST_PATH, "error", parsed.error.issues[0]?.message ?? "Invalid settings.");

  await runAction(
    LIST_PATH,
    async () => {
      const [provider, model] = parsed.data!.providerModel.split("::");
      const value = { provider, model };
      await db
        .insert(appSettings)
        .values({ key: "assistant", value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
      await audit(admin.id, "admin.assistant.settings", { targetType: "app_settings", targetId: "assistant", meta: value });
    },
    "Assistant settings saved.",
  );
}
