import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const roleEnum = pgEnum("role", ["author", "admin"]);
export const providerEnum = pgEnum("assistant_provider", ["anthropic", "openai", "google"]);
export const syncKindEnum = pgEnum("sync_kind", ["incremental", "full", "single"]);
export const syncStatusEnum = pgEnum("sync_status", ["running", "ok", "error"]);
export const ruleOperatorEnum = pgEnum("rule_operator", ["eq", "neq", "in", "not_in", "empty", "not_empty"]);

// ---------- Milestones (sub-stage) ----------

export type MilestoneKind = "status" | "date" | "flag";

/** Same operators as action_rules' `ruleOperatorEnum`, plus "contains" for ";"-joined multi-selects. */
export type MilestoneRuleOperator = "eq" | "neq" | "in" | "not_in" | "empty" | "not_empty" | "contains";

export type MilestoneIncludeRule = {
  packages?: string[];
  addOns?: string[];
  property?: { name: string; operator: MilestoneRuleOperator; value?: string | string[] };
} | null;

// ---------- Identity ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    name: text("name"),
    image: text("image"),
    role: roleEnum("role").notNull().default("author"),
    hubspotContactId: text("hubspot_contact_id"),
    // ---- Canonical author profile (mirrored from the HubSpot Contact at sync time; see
    // src/lib/data/profile.ts and src/lib/hubspot/contact-info.ts). Book-cache Project properties
    // are NOT the source of truth for these — see CLAUDE.md / review finding #1. ----
    phone: text("phone"),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    profileSyncedAt: timestamp("profile_synced_at", { mode: "date" }),
    passwordHash: text("password_hash"),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    invitedById: uuid("invited_by_id"),
    invitedAt: timestamp("invited_at", { mode: "date" }),
    lastLoginAt: timestamp("last_login_at", { mode: "date" }),
    disabledAt: timestamp("disabled_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_hubspot_contact_idx").on(t.hubspotContactId),
    index("users_role_idx").on(t.role),
  ],
);

// Auth.js adapter tables (shapes required by @auth/drizzle-adapter)
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("password_reset_user_idx").on(t.userId)],
);

// ---------- Books (HubSpot Projects) ----------

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hubspotProjectId: text("hubspot_project_id").notNull(),
    title: text("title").notNull().default("Untitled"),
    driveFolderId: text("drive_folder_id"),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("books_hubspot_project_idx").on(t.hubspotProjectId),
    index("books_user_idx").on(t.userId),
  ],
);

/** Latest snapshot of the HubSpot Project properties for a book. */
export const bookCache = pgTable(
  "book_cache",
  {
    bookId: uuid("book_id").primaryKey().references(() => books.id, { onDelete: "cascade" }),
    properties: jsonb("properties").$type<Record<string, string | null>>().notNull().default({}),
    stageKey: text("stage_key"),
    hubspotUpdatedAt: timestamp("hubspot_updated_at", { mode: "date" }),
    syncedAt: timestamp("synced_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("book_cache_stage_idx").on(t.stageKey)],
);

// ---------- Admin-editable configuration ----------

export type StageKind = "pipeline" | "derived";

/** Maps raw HubSpot stage values to what authors see. */
export const stageConfig = pgTable("stage_config", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  /** Raw HubSpot property values that map to this stage. Ignored for "derived" rows. */
  hubspotValues: jsonb("hubspot_values").$type<string[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  typicalWeeks: integer("typical_weeks"),
  isTerminal: boolean("is_terminal").notNull().default(false),
  /**
   * "pipeline" (default) rows come from the real HubSpot Pipeline Stage dropdown via
   * `hubspotValues`/`resolveStageKey`. "derived" rows have no HubSpot mapping — their state is
   * computed from `derivedMilestoneIds` instead (see src/lib/hubspot/derived-stages.ts). This lets
   * the portal show a finer-grained "typical path" than HubSpot's own pipeline without ever writing
   * back to HubSpot.
   */
  kind: text("kind").$type<StageKind>().notNull().default("pipeline"),
  /** stage_milestones ids whose combined state drives a "derived" row. Ignored for "pipeline" rows. */
  derivedMilestoneIds: jsonb("derived_milestone_ids").$type<string[]>().notNull().default([]),
  /** Which pipeline stage a derived row is grouped/ordered under. Null for pipeline rows. */
  parentStageKey: text("parent_stage_key"),
  /** false = omit a derived row entirely when none of its milestones are included/present. */
  showWhenEmpty: boolean("show_when_empty").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/** "If property X <op> value, show an action item." */
export const actionRules = pgTable("action_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyName: text("property_name").notNull(),
  operator: ruleOperatorEnum("operator").notNull(),
  value: jsonb("value").$type<string | string[] | null>(),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  severity: text("severity").notNull().default("action"), // action | info
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/** Friendly labels for HubSpot dropdown values, e.g. DE Status "in_progress" -> "Your editor is working on your manuscript". */
export const propertyDisplay = pgTable(
  "property_display",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: text("property_id").notNull(), // portal id from src/lib/hubspot/properties.ts
    rawValue: text("raw_value").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("property_display_idx").on(t.propertyId, t.rawValue)],
);

/**
 * Sub-stage checkpoints within a `stage_config` stage (e.g. "Cold read", "Premier review",
 * "NetGalley") driven by one raw HubSpot property. Not every author gets every milestone —
 * `includeRule` gates which ones apply, but a milestone with an actual (non-hidden) value always
 * shows regardless of the rule (data wins). See `src/lib/hubspot/milestones.ts` for evaluation.
 */
export const stageMilestones = pgTable(
  "stage_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageKey: text("stage_key")
      .notNull()
      .references(() => stageConfig.key, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    /** Raw HubSpot internal property name (not a portal id) driving this milestone's state. */
    propertyName: text("property_name").notNull(),
    kind: text("kind").$type<MilestoneKind>().notNull().default("status"),
    /** Status values (case-insensitive) meaning "done". */
    doneValues: jsonb("done_values").$type<string[]>().notNull().default([]),
    /** Values meaning "not happening" — the milestone is omitted entirely. */
    hiddenValues: jsonb("hidden_values").$type<string[]>().notNull().default([]),
    /** Values meaning "in progress"; when null, any non-empty non-done value counts as in progress. */
    inProgressValues: jsonb("in_progress_values").$type<string[] | null>(),
    linkProperty: text("link_property"),
    dateProperty: text("date_property"),
    /** Its value is appended to the label, e.g. "Premier review · Kirkus". */
    venueProperty: text("venue_property"),
    /** Author-facing link text for `linkProperty`'s href, e.g. "Read your {venue} review". Supports
     *  a `{venue}` placeholder filled from `venueProperty`'s friendly label. Null falls back to a
     *  generic "View" in the UI. */
    linkLabel: text("link_label"),
    /** Null = shown to everyone. Otherwise included if ANY listed condition matches. */
    includeRule: jsonb("include_rule").$type<MilestoneIncludeRule>(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("stage_milestones_stage_idx").on(t.stageKey)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

// ---------- Files & notes ----------

export const visibleFiles = pgTable(
  "visible_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    driveFileId: text("drive_file_id").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull().default("Other"),
    mimeType: text("mime_type"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("visible_files_book_idx").on(t.bookId), uniqueIndex("visible_files_book_file_idx").on(t.bookId, t.driveFileId)],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id),
    body: text("body").notNull(),
    visibleToAuthor: boolean("visible_to_author").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("notes_book_idx").on(t.bookId)],
);

// ---------- Assistant ----------

export type HandbookSection = { id: string; heading: string; text: string; tokenEstimate: number };

export const handbookVersions = pgTable(
  "handbook_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id),
    text: text("text").notNull(),
    sections: jsonb("sections").$type<HandbookSection[]>().notNull().default([]),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("handbook_active_idx").on(t.isActive)],
);

export type Citation = { sectionId: string; heading: string; quote?: string };

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    answer: text("answer").notNull().default(""),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    provider: providerEnum("provider"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    notInHandbook: boolean("not_in_handbook").notNull().default(false),
    rating: smallint("rating"), // 1 = up, -1 = down
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("chat_user_created_idx").on(t.userId, t.createdAt), index("chat_rating_idx").on(t.rating)],
);

// ---------- Ops ----------

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: syncKindEnum("kind").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    processed: integer("processed").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unmatched: integer("unmatched").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    cursorUpdatedAt: timestamp("cursor_updated_at", { mode: "date" }),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_actor_idx").on(t.actorId), index("audit_target_idx").on(t.targetType, t.targetId)],
);

export type User = typeof users.$inferSelect;
export type Book = typeof books.$inferSelect;
export type BookCache = typeof bookCache.$inferSelect;
export type StageConfig = typeof stageConfig.$inferSelect;
export type StageMilestone = typeof stageMilestones.$inferSelect;
export type ActionRule = typeof actionRules.$inferSelect;
export type PropertyDisplay = typeof propertyDisplay.$inferSelect;
export type VisibleFile = typeof visibleFiles.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type HandbookVersion = typeof handbookVersions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Feature tables kept in their own files; re-exported here so `@/db/schema` stays the single import.
export * from "./schema-team";
export * from "./schema-uploads";
export * from "./schema-comms";
export * from "./schema-auth";
