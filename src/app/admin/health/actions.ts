"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { runAction } from "../_lib/flash";
import { runFullSync, runIncrementalSync } from "../_integrations";

const LIST_PATH = "/admin/health";
const kindSchema = z.enum(["incremental", "full"]);

export async function triggerSyncAction(kind: string): Promise<void> {
  const admin = await requireAdmin();
  const k = kindSchema.parse(kind);
  await runAction(
    LIST_PATH,
    async () => {
      const result = k === "incremental" ? await runIncrementalSync() : await runFullSync();
      await audit(admin.id, "admin.sync.trigger", { targetType: "sync_run", meta: { kind: k, ...result } });
    },
    `${k === "incremental" ? "Incremental" : "Full"} sync started.`,
  );
}
