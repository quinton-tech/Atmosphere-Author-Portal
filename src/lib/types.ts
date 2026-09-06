/** Shared view types. Safe to import from client components (no server deps). */

export type Role = "author" | "admin";
export type AssistantProvider = "anthropic" | "openai" | "google";

export type StageView = {
  key: string;
  label: string;
  description: string;
  sortOrder: number;
  typicalWeeks: number | null;
  isTerminal: boolean;
  /** "pipeline" rows come from HubSpot's Pipeline Stage; "derived" rows are computed from milestones. */
  kind: "pipeline" | "derived";
  isDerived: boolean;
  /** "done" | "current" | "upcoming" relative to the book's current stage */
  state: "done" | "current" | "upcoming";
};

export type ActionItem = {
  id: string;
  title: string;
  message: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  severity: "action" | "info";
};

export type FileView = {
  id: string;
  label: string;
  category: string;
  mimeType: string | null;
  /** Portal URL that streams the file after an ownership check. Never a Drive link. */
  href: string;
  thumbnailHref: string | null;
};

export type NoteView = {
  id: string;
  body: string;
  createdAt: string; // ISO
};

export type BookSummary = {
  id: string;
  title: string;
  stageKey: string | null;
  stageLabel: string;
  isArchived: boolean;
  updatedAt: string; // ISO, last HubSpot change if known
};

export type TeamMember = {
  role: string; // "Developmental Editor"
  name: string;
  assignedAt: string | null; // ISO
  status: string | null; // friendly dropdown label
};

export type TimelineEvent = {
  id: string;
  at: string; // ISO
  title: string;
  detail: string | null;
  kind: "milestone" | "assignment" | "current";
  isFuture: boolean;
};

export type MilestoneView = {
  id: string;
  stageKey: string;
  stageLabel: string;
  label: string;
  description: string;
  kind: "status" | "date" | "flag";
  state: "done" | "in_progress" | "scheduled" | "pending";
  detail: string | null;
  at: string | null; // ISO
  href: string | null;
};

export type WebsiteView = {
  /** Author-facing site URL, normalised to https. */
  url: string | null;
  /** wp-admin URL, either derived from `url` or an admin override. */
  editUrl: string | null;
  hostingUrl: string;
  status: string | null;
  packageName: string | null;
  domainExpiry: string | null; // ISO
};

export type AuthorInfo = {
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

export type BookDetail = BookSummary & {
  /** Typical path (admin-configured). Shown as context; the pipeline is not strictly linear. */
  stages: StageView[];
  currentStage: StageView | null;
  /** Event-based timeline derived from dated HubSpot properties. This is the primary visual. */
  timeline: TimelineEvent[];
  team: TeamMember[];
  milestones: MilestoneView[];
  /** Null unless the author has a website in progress (websiteUrl, websiteDomain, or websiteStatus set). */
  website: WebsiteView | null;
  package: string | null;
  teaser: string | null;
  initiationDate: string | null; // ISO
  publicationDate: string | null; // ISO
  actions: ActionItem[];
  files: FileView[];
  notes: NoteView[];
  syncedAt: string | null; // ISO
  /** Raw HubSpot properties, admin-only; omitted for authors. */
  properties?: Record<string, string | null>;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  /** Contact details from HubSpot, read-only, shown on the Account page. */
  authorInfo?: AuthorInfo;
  /** Set when an admin is viewing as an author. */
  viewingAs?: { userId: string; email: string; name: string | null };
};

export type ChatCitation = { sectionId: string; heading: string; quote?: string };
