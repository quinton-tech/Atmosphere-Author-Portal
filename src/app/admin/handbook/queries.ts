import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { handbookVersions } from "@/db/schema";

export async function listHandbookVersions() {
  const rows = await db
    .select({
      id: handbookVersions.id,
      filename: handbookVersions.filename,
      tokenEstimate: handbookVersions.tokenEstimate,
      isActive: handbookVersions.isActive,
      createdAt: handbookVersions.createdAt,
      sections: handbookVersions.sections,
    })
    .from(handbookVersions)
    .orderBy(desc(handbookVersions.createdAt))
    .limit(100);
  return rows.map((r) => ({ ...r, sectionCount: r.sections.length }));
}
