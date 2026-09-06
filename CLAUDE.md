@AGENTS.md

# Atmosphere Author Portal

Author-facing portal for Atmosphere Press. Authors sign in and see where their book is in production, what they need to do (payments, manuscripts), curated files from Google Drive, and can ask a grounded assistant questions about the Author Handbook. Staff use `/admin`.

**Hard rules**
- Google Drive is READ ONLY, with **one exception**: authors may send files to their team (manuscripts, signed forms) via `/uploads`, which writes to Drive only through `src/lib/drive/uploads.ts`, using a SEPARATE service account credential (full `drive` scope, shared only on the master author folder so uploads land in the author's own folder under "From the author"). No other file may call a Drive mutating method; `src/lib/drive/uploads.guard.test.ts` fails the build otherwise. HubSpot is READ ONLY with **one exception**: an author may update their own contact details (phone, postal address) via `src/lib/hubspot/writes.ts`. That file and the concrete client are the only places allowed to call a HubSpot mutating method; `writes.test.ts` fails the build otherwise. Email is never self-service (it is the login identity and the HubSpot join key). Every contact update is throttled (5/day/user), validated with zod, written to HubSpot first, then mirrored into the cache, and audited with before/after. Every author upload is throttled (20/day/user), validated (type + size + magic bytes), recorded in `author_uploads`, audited, and emailed to `UPLOADS_NOTIFY_EMAIL` — see `src/lib/data/uploads.ts`.
- One author sees one author's data. Every book/file/chat query is scoped by the signed-in user's id inside `src/lib/data/*`, never in page code. No route may accept a book id without an ownership check via those helpers.
- Secrets live in env vars only (`src/lib/env.ts` validates them). Nothing vendor-specific reaches the client bundle.
- Admin routes check `role === "admin"` server-side on every request, in addition to `src/proxy.ts`.

**Scale**: 1,000 authors today, must hold 15,000–20,000. Sync is incremental and paginated (HubSpot returns 100/page; nightly full reconcile ≈ 200 pages). Every list query is indexed and paginated. No N+1 against HubSpot; the app reads only from Postgres at request time.

## HubSpot Project → portal
- The displayed properties are declared once in `src/lib/hubspot/properties.ts` (portal id, HubSpot label, kind, group). Internal HubSpot names are resolved from the object schema by label at sync time (`resolveInternalNames`), overridable in `app_settings.propertyMap`. Only listed properties are cached (`pickPortalProperties`).
- Stage comes from **Pipeline Stage** (portal id `pipelineStage`). Raw dropdown values → friendly labels via `property_display` (admin-editable) with a prettify fallback.
- **The pipeline is not linear.** Typical path: Onboarding → Developmental Editing → Proofreading → Cold Reading (sometimes) → Cover Design → Interior Design → Interior Design Proofing → Publicity, but stages repeat, double back, or run in parallel. So the primary visual is an event-based **timeline** (`buildTimeline`: dated properties like "DE Assigned", "Initiation Date", "Publication Date" plus a "Now: <stage>" marker), with the typical path shown only as context. Never render a strict step-progress bar as the only view.
- Team (BPM, PBC, AE, DE, PR, ID, CD) with assigned dates and statuses is shown to the author (`buildTeam`). Author contact info (phone, address) is shown and **editable** on Account; edits go through `writes.ts` (see hard rules). Whether those fields live on the Contact or the Project is `app_settings.contactInfoTarget` (default `contact`).

## Stack
- Next.js 16 (App Router, `src/`), React 19, TypeScript strict, Tailwind v4 (tokens in `src/app/globals.css`).
- Postgres (Neon) via Drizzle. Schema: `src/db/schema.ts`. Client: `src/db/index.ts`. Migrations: `npm run db:generate` / `db:migrate`. Seed: `npm run db:seed`.
- Auth.js v5 (`next-auth@beta`) with Drizzle adapter: Resend magic link + Credentials (Argon2id via `@node-rs/argon2`). Config in `src/auth.ts`. Admin TOTP via `otplib`.
- HubSpot: `@hubspot/api-client` in `src/lib/hubspot/`. Drive: `googleapis` service account in `src/lib/drive/`.
- Assistant: Vercel AI SDK (`ai` v7) with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`. Provider chosen at runtime from `app_settings`. Code in `src/lib/assistant/`.
- Tests: vitest (`npm test`). Scripts run with `tsx`.

## Next.js 16 notes
- `middleware.ts` is deprecated → use `src/proxy.ts` exporting `proxy()`.
- Read `node_modules/next/dist/docs/` before using an API you're unsure about. Route handlers: `route.ts`; `params` and `searchParams` are Promises.
- Server-only modules import `"server-only"`.

## Layout
```
src/app/(auth)/…        sign-in, magic link, reset password
src/app/(author)/…      dashboard, files, account, uploads, assistant
src/app/admin/…         staff panel
src/app/api/…           route handlers (cron, files proxy, chat, auth)
src/db/                 schema, client, seed, migrations
src/lib/env.ts          zod-validated env
src/lib/data/           ownership-scoped data access (the ONLY place pages read books/files/chat/uploads)
src/lib/hubspot/        client + sync + stage/action mapping
src/lib/drive/          read-only client + file streaming; uploads.ts is the one write exception
src/lib/assistant/      providers, handbook ingest, prompt, eval
src/lib/audit.ts        audit log helper
src/components/         UI (hand-built; no component library)
```

## Design tokens (match atmospherepress.com)
Roboto (800 headings, 400 body), Roboto Condensed for uppercase labels. White ground. Coral `#FF8466` only for "action needed". Teal `#67B7CD` for progress and links. Charcoal `#363636` for footer/admin shell. Pill buttons (`rounded-full`). Left-aligned type, no gradients, no icon-in-circle grids, no chat bubbles with avatars. Copy speaks to the author in second person.

## Conventions
- Server components by default; `"use client"` only for interactivity.
- Server actions in `actions.ts` beside the route, validated with zod, always re-check session + role.
- Write to `audit_log` for every admin mutation and every view-as.
- Keep files under ~300 lines; split by concern.
