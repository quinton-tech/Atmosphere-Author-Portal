# Build tasks (subagent briefs)

Each brief is self-contained so it can be handed to a subagent (Sonnet is sufficient). All agents must read `CLAUDE.md` first. Shared rules for every brief:

- Do **not** edit `src/db/schema.ts`, `package.json`, or `src/lib/types.ts`. If you need a schema/type/dependency change, list it in your final report.
- Keep the exported contracts described below exactly. Other agents build against them.
- Run `npm run typecheck` and `npm test` before reporting. Report what you built, what's untested, and anything you had to assume.
- Read `node_modules/next/dist/docs/` for any Next.js 16 API you're unsure about (`proxy.ts` not `middleware.ts`; `params` is a Promise).

Waves: **1** (auth, hubspot, drive, assistant, author-ui, admin-ui) can run in parallel because the contracts below are already in place. **2** is integration and hardening, run by the lead.

---

## 1. Auth (`src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/**`, `src/lib/auth/**`, `src/app/api/auth/[...nextauth]/route.ts`)

Replace the placeholder `src/auth.ts` with Auth.js v5 (`next-auth@beta`) using `@auth/drizzle-adapter` against `src/db/schema.ts` tables `users`, `accounts`, `sessions`, `verificationTokens`. Database sessions (not JWT) so admins can revoke.

Providers:
- **Resend** email provider (magic link). `from` = `env.EMAIL_FROM`. Link valid 15 minutes. Custom `sendVerificationRequest` with an on-brand HTML email (Roboto, white, one black pill button). **Only send if a user row with that email exists and `disabledAt` is null.** Otherwise silently succeed (no account enumeration).
- **Credentials**: email + password, verified with `@node-rs/argon2` (`verify`). Reject if `disabledAt` set. Rate limit: 10 attempts / 15 min per email and per IP (in-memory Map is fine for now; note it in report).

Callbacks: `session.user` = `{ id, email, name, role }`. Update `users.lastLoginAt` on sign-in and write `audit("auth.login")`.

Password flows (`src/lib/auth/password.ts` + routes):
- Set/change password from Account page (server action, requires session).
- Forgot password: form takes email → if user exists, create `password_reset_tokens` row (store SHA-256 of a 32-byte random token, 30 min expiry) and email the link `/reset-password?token=…`. Reset page validates, requires 12+ chars, checks against Have I Been Pwned range API (k-anonymity, fail-open on network error), hashes with Argon2id, deletes token, audits.

Admin 2FA (`src/lib/auth/totp.ts`): `otplib` TOTP. Enrollment page at `/admin/security` renders QR via `qrcode`. After password/magic-link sign-in, admins with `totpEnabled` must verify a code at `/verify-2fa` before any `/admin` route; store verification in an httpOnly cookie `ap_2fa` (signed HMAC of sessionToken + day, using `AUTH_SECRET`). Admins without TOTP enrolled are redirected to enroll on first `/admin` visit.

Invites (`src/lib/auth/invite.ts`): `inviteAuthor({ email, name, hubspotContactId, invitedById })` creates the user row if missing, then triggers the magic-link email. `resendInvite(userId)`, `revokeAccess(userId)` (sets `disabledAt`, deletes sessions), `forceSignOut(userId)` (deletes sessions). Each audits.

`src/proxy.ts`: redirect unauthenticated requests on `/(author)` and `/admin` to `/sign-in?next=…`; redirect non-admins away from `/admin`; enforce the 2FA cookie on `/admin`. Matcher excludes `_next`, `api/auth`, static files.

Pages (server components, on-brand, no component library): `/sign-in` (email field, "Send me a link" primary, "Use my password" toggle), `/check-email`, `/forgot-password`, `/reset-password`, `/verify-2fa`. Copy in second person. No "sign up" link anywhere.

Tests: `src/lib/auth/*.test.ts` for token hashing, rate limiter, TOTP verify (pure parts).

## 2. HubSpot sync (`src/lib/hubspot/**`, `src/app/api/cron/sync/route.ts`, `src/db/seed.ts`)

Read-only client in `src/lib/hubspot/client.ts` using `@hubspot/api-client` with `env.HUBSPOT_ACCESS_TOKEN`. Wrap in a thin interface so it can be mocked:

```ts
export interface HubSpotReader {
  getProjectSchema(): Promise<{ properties: { name: string; label: string; type: string; options?: {label: string; value: string}[] }[] }>;
  searchProjectsModifiedSince(since: Date | null, after?: string): Promise<{ results: HubSpotProject[]; nextAfter?: string }>; // 100/page
  getProject(id: string): Promise<HubSpotProject | null>;
  getContactsByIds(ids: string[]): Promise<Map<string, { id: string; email: string | null; firstname: string | null; lastname: string | null }>>; // batch read, ≤100 per call
}
export type HubSpotProject = { id: string; properties: Record<string, string | null>; updatedAt: Date; contactIds: string[] };
```

Object type comes from `env.HUBSPOT_PROJECT_OBJECT_TYPE`. Fetch the association Project→Contact via the associations API (or `associations=contacts` on the search). Respect rate limits: exponential backoff on 429, max 5 retries, and never more than 4 concurrent requests.

Property mapping: on each run, call `getProjectSchema()` once, then `resolveInternalNames(schema.properties, appSettings.propertyMap)` from `src/lib/hubspot/properties.ts`. Request only the mapped internal names from HubSpot (`properties=` param) and store `pickPortalProperties(raw, map)` in `book_cache.properties` (keys are portal ids like `pipelineStage`, `developmentalEditorAssigned`). Persist `unresolved` ids into `app_settings.propertyUnresolved` for the Health page. Also collect distinct raw values per enum property into `app_settings.enumValuesSeen` so admins can label them in `property_display`.

`src/lib/hubspot/sync.ts`:
- `runIncrementalSync()` — `since` = last successful run's `cursorUpdatedAt` minus 5 minutes (overlap), paginated. For each Project: find/create the `users` row by contact email (role author, no invite sent), upsert `books` by `hubspotProjectId` (title from a property; default `name` → make property name configurable via `app_settings.titleProperty`, fallback "Untitled"), upsert `book_cache` with all properties, `stageKey` via `resolveStageKey`, `hubspotUpdatedAt`. Batch DB writes (≤500 rows per statement). Record a `sync_runs` row with counts and errors; `unmatched` = Projects with no contact email.
- `runFullSync()` — same with `since = null`. Intended nightly. Must handle 20,000 Projects (≈200 pages) within Vercel's 300 s function limit or resume: process pages, persist `nextAfter` in the `sync_runs` row, and let the cron route re-invoke itself (fetch to its own URL with `CRON_SECRET`) until done.
- `syncSingleProject(hubspotProjectId)` and `syncAuthor(userId)` (all Projects for that contact) for the admin "Refresh" button.
- **Writes**: implement `HubSpotContactWriter` (from `src/lib/hubspot/writes.ts`) in `client.ts` as the ONLY mutating methods: `updateContactProperties(contactId, props)` → `crm.contacts.basicApi.update`, `updateProjectProperties(projectId, props)` → `crm.objects.basicApi.update(objectType, id, ...)`. Then add `updateAuthorContactInfo(userId, input)` in `src/lib/hubspot/contact-info.ts`: load user + most recent book cache + property map + `app_settings.contactInfoTarget`; `contactInfoSchema.parse`; `planContactInfoPatch`; throttle via `audit_log` count of `author.contact_info.update` in the last 24 h (`CONTACT_INFO_MAX_UPDATES_PER_DAY`); write to HubSpot; on success patch `book_cache.properties` for all that user's books and `audit("author.contact_info.update", { meta: { before, after, target } })`; on failure `audit("author.contact_info.failed")` and throw a user-safe error. `npm test` includes a guard that fails if any other file calls a HubSpot mutating method.

`src/app/api/cron/sync/route.ts`: `GET` with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this). `?kind=incremental|full`. Add `vercel.json` with two crons: `*/10 * * * *` incremental, `15 3 * * *` full.

`src/lib/hubspot/run-sync.ts`: CLI entry (`npm run sync:hubspot -- --kind=full`).

`src/db/seed.ts`: idempotent. Creates admin from `env.ADMIN_BOOTSTRAP_EMAIL`; seeds default `stage_config` rows for the real pipeline: onboarding, developmental_editing, proofreading, cold_reading, cover_design, interior_design, interior_proofing, publicity, published[terminal] with sensible labels/descriptions/typicalWeeks and empty `hubspotValues`; seeds `app_settings.assistant` = `{ provider: null, model: null }` and `app_settings.titleProperty = "name"`.

Tests: `stages.test.ts`, `rules.test.ts` (already-written pure functions), and `sync.test.ts` using a fake `HubSpotReader` and an in-memory stub of the few DB calls (or skip DB and test the pure planning step you factor out: given projects+contacts → list of upserts).

## 3. Google Drive (`src/lib/drive/**`, `src/app/api/files/[id]/route.ts`, `src/app/api/files/[id]/thumbnail/route.ts`)

`src/lib/drive/client.ts`: `googleapis` JWT auth from `env.GOOGLE_SERVICE_ACCOUNT_JSON_B64` with scope `https://www.googleapis.com/auth/drive.readonly` only. Interface:

```ts
export interface DriveReader {
  listFolder(folderId: string): Promise<DriveFile[]>;                 // files + subfolders, fields: id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink
  searchFolders(query: string, rootId?: string): Promise<DriveFile[]>; // for admin folder picker, name contains query, mimeType = folder
  getFile(fileId: string): Promise<DriveFile | null>;
  stream(fileId: string): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; size?: number; name: string }>; // alt=media; for Google Docs types use export to PDF
  thumbnail(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>; // fetch thumbnailLink server-side with auth
}
```

Route `GET /api/files/[id]`: `requireUser()` → `getVisibleFileForUser(effectiveUserId(u), id)` from `src/lib/data/books.ts`; 404 if null (never 403, don't confirm existence). Stream with `Content-Type`, `Content-Disposition: inline; filename="<label>.<ext>"`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. `?download=1` switches to `attachment`.

Route `GET /api/files/[id]/thumbnail`: same check, returns thumbnail bytes with `Cache-Control: private, max-age=86400`.

Admin helpers (`src/lib/drive/admin.ts`): `listFolderForAdmin(folderId)` returns files with a `visible` flag joined from `visible_files` for a book; `setFileVisibility(bookId, driveFileId, { visible, label, category })` upserts/deletes `visible_files` and audits. `linkFolder(bookId, folderId)` sets `books.driveFolderId` and audits.

Tests: MIME → extension helper, Content-Disposition filename sanitizer.

## 4. Assistant (`src/lib/assistant/**`, `src/app/api/chat/route.ts`, `src/app/api/chat/rate/route.ts`)

Provider-agnostic via Vercel AI SDK v7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`). Read the installed package docs in `node_modules/ai/README.md` and each provider's README; the API surface may differ from memory.

`providers.ts`: `getActiveModel()` reads `app_settings.assistant` `{provider, model}`; returns `{ provider, modelId, model: LanguageModel }`. `listAvailableModels()` returns, for each provider in `configuredProviders()`, a short curated list of model ids with display names and per-1M input/output prices. Default suggestions: Anthropic `claude-opus-5`, `claude-sonnet-5`; OpenAI current GPT-5 tier; Google current Gemini Pro/Flash. Confirm exact ids against the provider packages' docs, not memory, and note uncertainty in the report.

`handbook.ts`: `ingestHandbook(file: { name, bytes })` → text via `pdf-parse` or `mammoth` (docx); split into sections at headings (numbered headings or ALL-CAPS/short-line heuristics; fall back to ~1,200-word chunks), assign stable ids `§<n>.<m>`, estimate tokens (`chars/4`), insert `handbook_versions` (inactive). `activateHandbook(id)` flips `isActive` (single active), audits. `getActiveHandbook()` cached per process for 60 s.

`prompt.ts`: builds messages: fixed system prompt (grounded-only; cite section ids in a final line `Sources: §1.2, §4.1`; if not covered say so and refer to the Author Manager; never speculate on money/dates/contracts specific to the author; answer in second person, plain, concise) → handbook as one big block with each section prefixed `[§id heading]` → **cache boundary** → short author context (`Current stage: <label>. Book: <title>.`) → chat history (last 10 turns) → question. Use Anthropic `cache_control` via provider options on the handbook block; OpenAI auto-caches; Google: use explicit cached content if the SDK exposes it, else rely on none and note it.

`citations.ts`: parse the trailing `Sources:` line into `ChatCitation[]` by matching ids to the active handbook sections; strip that line from the displayed answer; set `notInHandbook` if the answer contains the refusal phrase.

`POST /api/chat`: `requireUser()`, zod-validate `{ bookId?, messages }`, per-user cap 40 messages/day (count `chat_messages` since midnight UTC), `streamText` → stream to client with `toUIMessageStreamResponse()` (or the v7 equivalent). On finish, insert `chat_messages` with provider/model/latency/usage/citations. `POST /api/chat/rate` sets `rating` on a message the user owns.

`eval/`: `cases.json` (start with 10 placeholder Q/A pairs marked TODO for staff), `run.ts` runs every case against one or all configured providers, grades with a simple rubric (contains expected keywords + cites at least one expected section), prints a table of pass rate / avg latency / est. cost. `npm run assistant:eval -- --provider=anthropic`.

Client component `src/components/assistant/AssistantPanel.tsx` (`"use client"`, uses `@ai-sdk/react` `useChat`): a side panel, not full-screen bubbles. Plain text field, streaming answer, citations rendered as small "From: 6.2 Interior design proofs" chips with the section text in a `<details>`. Thumbs up/down. Suggested questions passed in as props.

## 5. Author UI (`src/app/(author)/**`, `src/components/**` except assistant)

Routes: `/dashboard` (redirects to `/books/[defaultBookId]` or an empty state), `/books/[bookId]`, `/books/[bookId]/files`, `/account`. Layout `(author)/layout.tsx`: slim header with wordmark text "atmosphere" (weight 800) + "Author Portal" eyebrow, book switcher (if >1 book), account link, sign-out; a persistent coral banner "Viewing as <name>. Stop" when `user.viewingAs` is set (form posts to admin action `stopViewAs`). Footer charcoal.

Data: `requireUser()`, `effectiveUserId()`, `listBooksForUser`, `getBookForUser`, `defaultBookIdForUser`. Never query `books` directly.

Components: **`Timeline`** is the primary visual: vertical on mobile, horizontal on wide screens; renders `book.timeline` events (milestone = solid teal dot, assignment = hollow teal dot with role + name + status, current = coral dot with halo labelled "Now: <stage>", future events greyed with a dashed connector). Because the pipeline can double back or run in parallel, do not imply strict order beyond the dates. `TypicalPath` (secondary, collapsed by default) shows `book.stages` as a small horizontal path with the current stage highlighted. `TeamList` shows `book.team` (role, name, "since <date>", status). `BookHeader` shows title, package, publication date if set, and the teaser in a quiet serif-free pull quote. `StageNow` card ("What's happening now" from `description` + "usually takes about N weeks"), `ActionList` (coral border, pill "Action needed", CTA as black pill button; `info` severity uses teal tint), `NotesList`, `FileGrid` (grouped by category, thumbnail via `thumbnailHref`, open + download), `LastUpdated` ("Updated 12 minutes ago from our production system"), `EmptyState` ("We're setting up your book. Check back soon or email your Author Manager.").

Account page: email (read-only, with "To change your email, contact your Author Manager"), **contact details form** (phone, street, city, state/region, postal code, country) pre-filled from `getAuthorInfoForUser`, submitting to a server action that calls `updateAuthorContactInfo` (from brief 2; stub if absent) and shows "Saved. Our team will see the update within a few minutes." or the user-safe error; set/change password form (calls the auth module's server action `setPassword` from `src/lib/auth/password.ts`; if not present yet, stub the import and note it), "Sign out everywhere".

Design: follow `CLAUDE.md` tokens. Left-aligned, generous whitespace, 72ch max prose, no gradients, no cards-for-everything. Mobile first. Include `AssistantPanel` (from brief 4; if the file doesn't exist yet, render a placeholder button and note it) with suggested questions derived from `currentStage.label`.

## 6. Admin UI (`src/app/admin/**`)

Layout: charcoal left rail (Authors, Books, Stages, Action rules, Handbook, Assistant, Log, Health, Security), white content. `requireAdmin()` in layout **and** each server action.

Pages + server actions (`actions.ts` beside each; zod-validate; audit every mutation):
- `/admin/authors`: search box (name/email/title, `ILIKE`, paginated 50/page with cursor), table: name, email, books+stage, last login, invited, disabled. Row actions: Invite / Resend / Revoke / Force sign-out (call `src/lib/auth/invite.ts`; stub if absent), **View as** (sets `VIEW_AS_COOKIE` from `src/lib/session.ts`, audits `admin.view_as`, redirects to `/dashboard`). `/admin/authors/[id]`: detail with books, raw cached properties (`getBookForUser(id, bookId, {includeProperties:true})`), notes editor (visible-to-author toggle), Drive: folder picker (search via `src/lib/drive/admin.ts`, stub if absent) and file visibility checklist with label + category inputs, "Refresh from HubSpot" (calls `syncAuthor`, stub if absent).
- `/admin/stages`: editable table of `stage_config` (label, description, hubspotValues as comma list, sortOrder, typicalWeeks, isTerminal), add/delete, live preview using `ProductionTracker` (from brief 5; stub if absent). Show "Unmapped values seen" = distinct `book_cache.properties[stageProperty]` not in any `hubspotValues`.
- `/admin/labels`: editor for `property_display` (property select from `PROJECT_PROPERTIES` enums, raw value, friendly label, description). Pre-fill rows from `app_settings.enumValuesSeen` so every dropdown value HubSpot actually uses appears here, unlabelled until staff name it.
- `/admin/rules`: CRUD for `action_rules` with operator select and a "Preview against author" email field that evaluates `evaluateActionRules`.
- `/admin/handbook`: upload form (PDF/DOCX ≤ 25 MB) → `ingestHandbook`; list versions with token estimate, section count, active flag; "Make active"; "Test a question" textarea that calls the chat route server-side against a chosen version.
- `/admin/assistant`: provider + model select from `listAvailableModels()`, save to `app_settings.assistant`; run eval button (spawns `eval/run` for one provider, shows results); log table of `chat_messages` with filters (rating = -1, notInHandbook), paginated.
- `/admin/log`: `audit_log` paginated, filter by action/actor.
- `/admin/health`: last 20 `sync_runs`, active handbook, configured providers, counts (users, books, unmapped stages), weekly active authors (distinct `sessions.userId` updated in 7 days — approximate with `users.lastLoginAt`).
- `/admin/security`: TOTP enrollment (from brief 1; stub if absent).

Tables must paginate; never load all 20k users. Use plain `<table>` with condensed uppercase headers per tokens. Forms use server actions with `useActionState` for errors.

---

## Wave 2 (lead): integration
- Resolve stubs left by wave 1; run `npm run typecheck && npm test && npm run build`.
- Cross-account access tests: for each `/api/files/*`, `/books/[id]`, `/api/chat` verify user A cannot read user B's data.
- `README.md` with local setup (Neon branch, `.env`, `db:push`, `db:seed`, `dev`), deploy notes (Vercel env, crons), runbooks (rotate HubSpot token, update handbook, sync failure).
- Create GitHub repo (`gh repo create`, private), push.
