import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, propertyDisplay } from "@/db/schema";
import { PROJECT_PROPERTIES } from "@/lib/hubspot/properties";

export type LabelRow = { id: string | null; propertyId: string; rawValue: string; label: string; description: string };

/** One row per (enum property, raw value): from property_display if labelled, or from
 *  app_settings.enumValuesSeen if HubSpot uses the value but nobody has named it yet. */
export async function listLabelGroups(): Promise<{ propertyId: string; propertyLabel: string; rows: LabelRow[] }[]> {
  const [displayRows, [settingsRow]] = await Promise.all([
    db.select().from(propertyDisplay),
    db.select().from(appSettings).where(eq(appSettings.key, "enumValuesSeen")).limit(1),
  ]);

  const seen = (settingsRow?.value as Record<string, string[]> | undefined) ?? {};
  const byProp = new Map<string, Map<string, LabelRow>>();

  const enumProps = PROJECT_PROPERTIES.filter((p) => p.kind === "enum");
  for (const p of enumProps) byProp.set(p.id, new Map());

  for (const [propertyId, values] of Object.entries(seen)) {
    if (!byProp.has(propertyId)) byProp.set(propertyId, new Map());
    const m = byProp.get(propertyId)!;
    for (const v of values) m.set(v, { id: null, propertyId, rawValue: v, label: "", description: "" });
  }
  for (const row of displayRows) {
    if (!byProp.has(row.propertyId)) byProp.set(row.propertyId, new Map());
    const m = byProp.get(row.propertyId)!;
    m.set(row.rawValue, { id: row.id, propertyId: row.propertyId, rawValue: row.rawValue, label: row.label, description: row.description });
  }

  const labelFor = (id: string) => PROJECT_PROPERTIES.find((p) => p.id === id)?.friendly ?? PROJECT_PROPERTIES.find((p) => p.id === id)?.label ?? id;

  return [...byProp.entries()]
    .map(([propertyId, m]) => ({
      propertyId,
      propertyLabel: labelFor(propertyId),
      rows: [...m.values()].sort((a, b) => a.rawValue.localeCompare(b.rawValue)),
    }))
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));
}
