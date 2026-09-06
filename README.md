# Atmosphere Author Portal

Author-facing portal for Atmosphere Press. Authors sign in and see where their book is in production, what they need to do (payments, manuscripts), curated files from Google Drive, and can ask a grounded assistant questions about the Author Handbook. Staff use `/admin`.

Reads from HubSpot and Google Drive. Drive is never written to. The only HubSpot write is an author updating their own phone or postal address, through one guarded module (`src/lib/hubspot/writes.ts`) — email is never self-service, since it's the login identity and the HubSpot join key.

## Architecture in one paragraph

Next.js 16 app (App Router, `src/`) on Vercel. Postgres (Neon) via Drizzle holds users/sessions, a cache of HubSpot Project data (`books` + `book_cache`), admin-editable configuration (pipeline stages, action rules, friendly labels, Drive file visibility, handbook versions), chat history, and an audit log. Two Vercel Cron jobs hit `/api/cron/sync`, incremental and full reconcile (paginated and resumable to handle 20k+ authors within the function time limit) — both committed as once-daily in `vercel.json` because the Vercel Hobby plan only allows daily cron schedules; on a Pro plan, change the incremental job's `schedule` to `*/10 * * * *` so stage changes reach authors within ten minutes (see `docs/DEPLOY.md` §10). Until then, `/admin/health`'s "Run incremental sync" button is the fast path. The app itself never calls HubSpot at request time — pages read only from Postgres, scoped to the signed-in user by helpers in `src/lib/data/`. Drive files stream through the portal after the same ownership check, via a service account. The assistant (Vercel AI SDK) loads the whole Author Handbook into the prompt with provider-side caching, on whichever of Anthropic / OpenAI / Google an admin has configured and selected in `/admin/assistant`.

## Local setup

Install dependencies:

```bash
npm install
```

Copy the env template and fill in at least `DATABASE_URL`, `AUTH_SECRET`, and `CRON_SECRET` (see `.env.example` for every var and `docs/DEPLOY.md` for where each one comes from):

```bash
cp .env.example .env
```

Create the tables from `src/db/schema.ts` (local/dev only — see `docs/DEPLOY.md` for why production uses migrations instead):

```bash
npm run db:push
```

Seed the first admin (needs `ADMIN_BOOTSTRAP_EMAIL` set in `.env`) and the default pipeline stages:

```bash
npm run db:seed
```

Start the dev server:

```bash
npm run dev
```

Without `HUBSPOT_ACCESS_TOKEN` / `GOOGLE_SERVICE_ACCOUNT_JSON_B64` / a provider API key set, the app still runs — sync, Drive, and the assistant just stay inactive until those are configured. Sign in as the bootstrapped admin with a magic link (needs `RESEND_API_KEY`) or set a password for that account directly in the database for a fully offline start.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest (includes the HubSpot-write guard test) |
| `npm run db:generate` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply generated migrations (production) |
| `npm run db:push` | Push schema directly, no migration files (local/dev only) |
| `npm run db:studio` | Drizzle Studio (browse/edit the database) |
| `npm run db:seed` | Idempotent seed: bootstrap admin, default stages, default `app_settings` |
| `npm run sync:hubspot -- --kind=full` | Manual HubSpot sync from the CLI (`--kind=incremental` is the default) |
| `npm run assistant:eval -- --provider=anthropic` | Run the handbook Q&A eval against one or all configured providers |

## How admin-editable configuration works

Everything staff can tune lives in the database, not in code, and is edited under `/admin`:

- **Stages** (`/admin/stages`, table `stage_config`) — the friendly stages authors see (Onboarding, Developmental Editing, …). Each stage row lists the raw HubSpot `pipelineStage` dropdown values that map to it (`hubspotValues`). The page also shows "unmapped values seen" — raw values present in `book_cache` that no stage currently claims — so staff can keep the mapping current as HubSpot's dropdown changes.
- **Labels** (`/admin/labels`, table `property_display`) — friendly text for raw HubSpot enum values (e.g. a DE status code → "Your editor is working on your manuscript"). Pre-filled from `app_settings.enumValuesSeen`, which the sync accumulates automatically, so every value HubSpot actually uses shows up here unlabelled until named.
- **Action rules** (`/admin/rules`, table `action_rules`) — "if property X `<op>` value, show this action item" (coral "Action needed" or informational teal), with a preview against a real author's data.
- **Drive visibility** (`/admin/authors/[id]`, table `visible_files`) — per book, staff link a Drive folder and choose which files inside it are visible to the author, with a label and category. Nothing in the linked folder is visible by default.
- **Handbook** (`/admin/handbook`, table `handbook_versions`) — upload a PDF/DOCX, it's parsed into cited sections; staff can test a question against a specific version before flipping it active. Only one version is active at a time.
- **Assistant model** (`/admin/assistant`, `app_settings.assistant`) — pick which configured provider/model the chat assistant uses; only providers with an API key set in the environment appear as options.

Property mapping itself (which raw HubSpot internal property name feeds each portal field) is resolved automatically by label at sync time (`src/lib/hubspot/properties.ts`), with `app_settings.propertyMap` as a manual override for anything that can't be resolved — surfaced on `/admin/health` as "Unresolved properties".

## More documentation

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Vercel + Neon production setup, every environment variable and where to get it, first-admin bootstrap, launch checklist.
- [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md) — symptom → check → fix for the situations that come up in operation (token rotation, stuck sync, handbook updates, model switching, login trouble, wrong stage, revoking an admin, database restore).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data flow, ownership scoping, the single HubSpot write path, the auth session model, and the assistant prompt/caching design.
- [`docs/BUILD-TASKS.md`](docs/BUILD-TASKS.md) — the original module briefs this app was built from; useful background on intent and contracts, not a live operating doc.
