import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Team directory, imported from atmospherepress.com's public "Our Team" page (see
 * src/lib/team/import.ts). Purely presentational — matched to a book's HubSpot-assigned team
 * member (src/lib/hubspot/timeline.ts buildTeam) by `nameKey` so the author sees a photo, website
 * title, and a short "what I do for authors" blurb next to the HubSpot role/assignment.
 *
 * `locked` rows were hand-edited by an admin; a re-import must not overwrite their content fields
 * (see planTeamImport in src/lib/team/import.ts), only touch `importedAt`.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    departments: jsonb("departments").$type<string[]>().notNull().default([]),
    photoUrl: text("photo_url"),
    whatIDo: text("what_i_do"),
    background: text("background"),
    whoIAm: text("who_i_am"),
    /** Normalised via src/lib/team/parse.ts nameKey(), for matching against HubSpot-assigned names. */
    nameKey: text("name_key").notNull(),
    showToAuthors: boolean("show_to_authors").notNull().default(true),
    /** Set true whenever an admin edits a field by hand; import then skips content fields for this row. */
    locked: boolean("locked").notNull().default(false),
    importedAt: timestamp("imported_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_members_slug_idx").on(t.slug),
    index("team_members_name_key_idx").on(t.nameKey),
  ],
);

export type TeamMemberRow = typeof teamMembers.$inferSelect;
