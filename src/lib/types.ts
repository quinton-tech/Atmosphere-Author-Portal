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
  /** The date most meaningful to the author for this phase (ISO): a real milestone/initiation/publication date
   *  when we have one, else HubSpot's stage-entered date, else null. Migration artifacts are filtered out. */
  enteredAt: string | null;
  /** How we know a "done" phase is done: "confirmed" (a dated event or milestone), "inferred" (the pipeline
   *  moved past it but HubSpot has no record), or null when not done. */
  completion: "confirmed" | "inferred" | null;
  /** "done" | "current" | "upcoming" relative to the book's current stage */
  state: "done" | "current" | "upcoming";
};

/** One row of the author-facing phase timeline: a stage plus everything that happened in it. */
export type PhaseView = StageView & {
  events: TimelineEvent[];
  milestones: MilestoneView[];
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

export type PrimaryContact = {
  /** Role key from TEAM_ROLES, e.g. "bpm". */
  roleKey: string;
  /** Author-facing role label, e.g. "Book Production Manager". */
  roleLabel: string;
  name: string;
  email: string | null;
  /** Website title / photo when the team directory knows this person. */
  title: string | null;
  photoUrl: string | null;
  /** One sentence: what this person handles for the author. Admin-editable. */
  handles: string;
};

export type NextUpdate = {
  /** e.g. "Your interior proof should reach you around" */
  label: string;
  at: string | null; // ISO estimate, may be null when unknown
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
  /** Descriptive link text, e.g. "Read your Kirkus review". Null when href is null. */
  linkLabel: string | null;
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
  /** All phases in typical-path order with their events and milestones. Primary visual. */
  phases: PhaseView[];
  /** The one person the author should reach out to. Null if the role isn't assigned yet. */
  primaryContact: PrimaryContact | null;
  /** Estimated next thing the author will hear about, from typical stage durations. */
  nextUpdate: NextUpdate | null;
  /** Portal proxy URL of the cover image (first visible file in the "Cover" category), if any. */
  coverHref: string | null;
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
