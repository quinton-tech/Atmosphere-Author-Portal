# Deploy

Production setup for one developer running Vercel + Neon. Read top to bottom the first time; after that, treat each section as reference.

## 1. Neon project and branches

1. Create a Neon project (any region close to your Vercel deployment region).
2. Neon gives you a `main` branch by default — this is production. Copy its pooled connection string (Neon's dashboard → **Connection Details** → make sure "Pooled connection" is selected, since Vercel's serverless functions need pooling) for use as `DATABASE_URL` below.
3. Create a **preview branch** off `main` (Neon dashboard → Branches → New Branch, or `neon branches create --name preview`). Use its connection string as `DATABASE_URL` for Vercel Preview deployments (Vercel → Project → Settings → Environment Variables → scope a second `DATABASE_URL` to "Preview"). This keeps preview deploys and PR builds from writing into production data.
4. Optionally connect Neon's GitHub integration so it creates/deletes a preview branch automatically per pull request — otherwise create/drop the preview branch by hand.

## 2. Environment variables

Set these in Vercel (Project → Settings → Environment Variables), scoped to Production (and Preview, where noted). `src/lib/env.ts` validates all of this at runtime with zod — a missing required var fails loudly on first request, not silently.

| Variable | Required | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Yes | Neon connection string (pooled), per branch — see §1 |
| `AUTH_SECRET` | Yes | Generate locally, see §3 |
| `AUTH_URL` | Recommended | Your production URL, e.g. `https://portal.atmospherepress.com` |
| `APP_NAME` | No | Defaults to "Atmosphere Author Portal" |
| `RESEND_API_KEY` | Yes (for sign-in) | Resend dashboard → API Keys |
| `EMAIL_FROM` | No | Defaults to `Atmosphere Press <portal@atmospherepress.com>`; must be on a domain verified in Resend |
| `HUBSPOT_ACCESS_TOKEN` | Yes (for sync) | HubSpot Private App, see §4 |
| `HUBSPOT_PROJECT_OBJECT_TYPE` | Yes (for sync) | The Project custom object's type id or fully-qualified name from HubSpot, e.g. `2-12345678` or `p_project` |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | Yes (for Drive) | Base64 of the service-account JSON key, see §5 |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Recommended | The Drive folder id staff work under; scopes the admin folder picker (see §4) |
| `GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64` | No (optional feature) | A SECOND, distinct service account's JSON key, base64-encoded — see §10 |
| `GOOGLE_UPLOADS_ROOT_FOLDER_ID` | No (optional feature) | Drive folder shared as Editor with the uploads service account — see §10 |
| `UPLOADS_NOTIFY_EMAIL` | No (optional feature) | Staff inbox emailed on every author upload — see §10 |
| `ANTHROPIC_API_KEY` | One of these three | Anthropic Console → API Keys |
| `OPENAI_API_KEY` | One of these three | OpenAI dashboard → API Keys |
| `GOOGLE_GENERATIVE_AI_API_KEY` | One of these three | Google AI Studio → API Keys |
| `CRON_SECRET` | Yes | Generate locally, see §6 |
| `ADMIN_BOOTSTRAP_EMAIL` | Yes (first deploy) | The email address that should become the first admin, see §7 |

At least one of the three assistant provider keys is needed for the assistant to work at all; unconfigured providers simply don't appear as choices in `/admin/assistant`.

### Generating `AUTH_SECRET`

```bash
openssl rand -base64 32
```

### Generating `CRON_SECRET`

```bash
openssl rand -hex 32
```

Vercel Cron sends this back as `Authorization: Bearer <CRON_SECRET>` on every scheduled hit to `/api/cron/sync` (see `vercel.json` for the schedule and `src/app/api/cron/sync/route.ts`, which rejects anything else with 401). There's nothing to configure on the Vercel Cron side beyond the env var matching — Vercel reads `vercel.json`'s `crons` array and adds the header itself using the same `CRON_SECRET` value from your project's environment variables.

## 3. HubSpot Private App

1. In HubSpot: Settings → Integrations → Private Apps → Create a private app.
2. Under Scopes, grant exactly what `.env.example` documents:
   - `crm.objects.contacts.read`
   - `crm.objects.custom.read`
   - `crm.schemas.custom.read`
   - `crm.objects.contacts.write` (or `crm.objects.custom.write` instead, only if the author-editable contact fields — phone/address — live on the Project object rather than the Contact; see `app_settings.contactInfoTarget`)
3. Do not grant any other write scope. `src/lib/hubspot/writes.ts` and `src/lib/hubspot/client.ts` are the only files allowed to call a mutating HubSpot method, and `src/lib/hubspot/writes.test.ts` fails the build if that's violated — but the API token itself should also be the last line of defense, so keep scopes minimal.
4. Copy the generated token into `HUBSPOT_ACCESS_TOKEN`.
5. Find your Project custom object's type id (Settings → Objects → your custom object, or via the CRM API) and set `HUBSPOT_PROJECT_OBJECT_TYPE`.

Rotating this token later is covered in `docs/RUNBOOKS.md`.

## 4. Google Cloud service account (Drive)

1. In Google Cloud Console, create (or reuse) a project, then create a Service Account (IAM & Admin → Service Accounts).
2. Create a JSON key for that service account and download it.
3. Base64-encode the whole JSON file and set it as `GOOGLE_SERVICE_ACCOUNT_JSON_B64`:

   ```bash
   base64 -i service-account.json | tr -d '\n'
   ```

4. In Google Drive, share the root folder that contains all author folders with the service account's email address (the `client_email` field in the JSON key — looks like `something@project-id.iam.gserviceaccount.com`). Viewer access is enough; `src/lib/drive/client.ts` requests only the `drive.readonly` scope, so nothing in this app can write to Drive even if broader access were granted.
5. Set `GOOGLE_DRIVE_ROOT_FOLDER_ID` to that shared root folder's id (the last path segment of its Drive URL). The admin folder picker (`src/app/admin/authors/[id]/DrivePanel.tsx`) scopes its search to this folder; if unset, it searches everything the service account can see.

## 5. Resend (email)

1. Add and verify your sending domain in the Resend dashboard (Domains → Add Domain), including its DKIM records.
2. Add a DMARC record for the domain (`_dmarc.yourdomain.com` TXT, e.g. `v=DMARC1; p=quarantine; rua=mailto:you@yourdomain.com`) — Resend's domain setup screen shows the DKIM records to add but DMARC is a separate DNS record you add yourself.
3. Wait for DNS to verify (can take a few minutes to a few hours).
4. Create an API key (API Keys → Create) and set `RESEND_API_KEY`.
5. Set `EMAIL_FROM` to an address on the verified domain, e.g. `Atmosphere Press <portal@atmospherepress.com>`.

Without a verified domain, Resend will still send from its own test domain in sandbox mode, which is fine for preview/testing but not for production — magic-link and password-reset email deliverability depends on this being done properly.

## 6. Database migrations: `db:migrate` vs `db:push`

- **`npm run db:push`** applies `src/db/schema.ts` directly to whatever database `DATABASE_URL` points at, no migration files. Fast, fine for local development and for your preview branch, but it has no history and can't be reviewed or rolled back in the normal sense.
- **`npm run db:generate`** + **`npm run db:migrate`** is the production path: `db:generate` diffs `src/db/schema.ts` against the last migration and writes a new SQL file under the Drizzle migrations folder; `db:migrate` applies pending migration files to `DATABASE_URL`. Commit the generated migration file to the repo.

Workflow for a schema change headed to production:

```bash
npm run db:generate
```

Review the generated SQL, commit it, then apply it to production (either as a deploy step or by hand against the production `DATABASE_URL`):

```bash
npm run db:migrate
```

Never run `db:push` against the production database — it can silently apply a destructive diff (e.g. drop a column Drizzle thinks is gone) with no migration record to review first.

## 7. First admin bootstrap

1. Set `ADMIN_BOOTSTRAP_EMAIL` to the email address that should be the first admin, in the production environment variables.
2. Run the seed script against production once the schema is in place:

   ```bash
   npm run db:seed
   ```

   This creates that user with `role: "admin"` (or promotes an existing user row with that email), and seeds the default pipeline stages and `app_settings` defaults (`assistant`, `titleProperty`, `contactInfoTarget`, `propertyMap`) — all idempotent, safe to re-run.
3. Sign in as that admin via the magic-link flow (`/sign-in`) — Resend must be configured (§5) for this to arrive.

There is no admin UI to promote or demote a user's role after the first bootstrap; see `docs/RUNBOOKS.md` for how that's currently done.

## 8. Enrolling TOTP (admin two-factor)

1. Sign in as the admin account.
2. Visiting any `/admin` route redirects an admin without TOTP enrolled to `/admin/security` automatically (`src/proxy.ts`).
3. Scan the QR code with an authenticator app (1Password, Authy, Google Authenticator, etc.) and enter the 6-digit code to finish enrollment.
4. From then on, every sign-in into `/admin` requires a fresh code once a day (`/verify-2fa`), tracked by a signed cookie, separate from the session cookie itself.

Every additional admin you create must enroll TOTP the same way on their first `/admin` visit — there's no way to skip it.

## 9. Messages (optional)

"Messages from your team" (`/messages`) shows an author the emails your team has sent them and their replies, read-only from HubSpot Engagement Emails logged on their Contact record (`src/lib/hubspot/engagements.ts`, `src/lib/data/messages.ts`).

1. Add the **`sales-email-read`** scope to the same HubSpot Private App from §3 (Settings → Integrations → Private Apps → your app → Scopes). No new environment variable is needed — it reuses `HUBSPOT_ACCESS_TOKEN`.
2. Only emails an Atmosphere staff member has actually logged to HubSpot appear — nothing is invented, and notes/calls/tasks/meetings are never shown, only the `emails` engagement type.
3. An author's messages refresh from HubSpot at most once every 10 minutes (per author, on-demand when they visit `/messages`), not on a cron schedule — there's nothing to add to `vercel.json` for this.
4. If the token is missing `sales-email-read`, HubSpot returns 403 and the page shows "Messages aren't available yet" instead of an error; `/admin/messages` lists every author's last sync error so a missing scope is easy to spot (it shows up as the same error across every row).

## 10. Verifying crons in the Vercel dashboard

1. Deploy with `vercel.json` present — it declares two crons hitting `/api/cron/sync?kind=incremental` and `?kind=full`. **The committed schedules are once-daily (`30 3 * * *` and `15 3 * * *`) because Vercel Hobby only allows daily crons.** On Pro, change the incremental schedule to `*/10 * * * *` so stage changes reach authors within ten minutes; until then the admin "Run incremental sync" button on `/admin/health` is the fast path.
2. In the Vercel dashboard: Project → Settings → Cron Jobs should list both, showing next scheduled run.
3. After the first scheduled run (or trigger one manually from `/admin/health` — see below), check Project → Logs, filtered to `/api/cron/sync`, for a 200 response and check `/admin/health`'s "Last 20 sync runs" table for a row with `status: ok`.
4. You can also trigger a sync immediately without waiting for the schedule, from `/admin/health` → "Run incremental sync" / "Run full sync" buttons, or from the CLI:

   ```bash
   npm run sync:hubspot -- --kind=full
   ```

## 11. Author uploads (optional)

Lets authors send files (manuscripts, signed forms) to their team from `/uploads`, and lets admins upload the Author Handbook from `/admin/handbook`. This is the one approved exception to "Drive is read-only" (see CLAUDE.md) — it writes through a SECOND, separate service account, distinct from the read-only one in §4, so a compromised or misconfigured uploads credential can never touch the read-only Drive tree the rest of the app serves from.

**Bytes never pass through this app's server.** Both flows use a direct-to-Drive *resumable upload*: the browser calls a small route handler (`POST /api/uploads/session` for authors, `POST /api/admin/handbook/session` for the handbook) that validates everything up front and asks Drive to open a resumable session, then the browser PUTs the file straight to the returned Google session URI (`src/lib/uploads/resumable-client.ts`), and finally calls a `.../complete` route so the server can confirm with Drive what landed and record it. This is deliberate: Vercel caps every function's request body at 4.5MB regardless of any Next.js config (https://vercel.com/docs/functions/limitations#request-body-size), which is well under the 50MB/25MB this app advertises — routing the bytes through our own server would silently break any upload past 4.5MB. See `src/lib/drive/uploads.ts` for the Drive-side half of the protocol.

**If you add a Content-Security-Policy later** (there is none today — see `src/proxy.ts` and `next.config.ts`), its `connect-src` must allow `https://www.googleapis.com`, since the upload PUT and status-check requests go out directly from the author's/admin's browser to Google, not through this app's origin.

1. In Google Cloud Console, create a second Service Account (or reuse the project from §4, but a distinct account) and a JSON key for it, same as §4 steps 1-3.
2. Base64-encode it and set `GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64` — note this is a **different** env var from `GOOGLE_SERVICE_ACCOUNT_JSON_B64`; do not reuse the same key for both.
3. Create (or choose) an empty Drive folder to be the uploads root, and share it with this service account's `client_email` as **Editor** (not Viewer — it needs to create subfolders and files). Set its id as `GOOGLE_UPLOADS_ROOT_FOLDER_ID`. The handbook flow creates its own "Handbook" subfolder under this same root.
4. `src/lib/drive/uploads.ts` requests only the `drive.file` scope, so even with Editor access on the shared folder, this credential can only see files/folders it created itself — it can never list or read anything else in Drive, including the folder tree from §4. `src/lib/drive/uploads.guard.test.ts` fails the build if any other file tries to call a Drive write method (including a raw `fetch()` to Drive's upload endpoint).
5. Set `UPLOADS_NOTIFY_EMAIL` to the staff inbox that should get an email (via Resend, so `RESEND_API_KEY` from §5 must also be set) every time an author sends a file.
6. All three vars are optional — if unset: `/uploads` shows a friendly "not set up yet" message instead of erroring, and `/admin/handbook` falls back to a plain `<form>` upload capped at 4MB (Vercel's hard function limit) with a notice pointing back here. In demo mode (`DEMO_MODE=1`), author uploads work end-to-end without any of this configured: the file is recorded with `status: "demo"` and Drive is never called — no bytes are sent anywhere, not even to this app's own server.
7. Staff review incoming files at `/admin/uploads`.
8. A session an author or admin starts but never finishes (browser closed mid-upload, network drop with no successful retry) stays `status: "pending"` for up to 24h; the nightly `/api/cron/sync` run (see §10) marks anything older than that `"failed"` so it doesn't linger forever.

## Launch checklist

- [ ] Neon `main` (production) and a `preview` branch both exist; `DATABASE_URL` is scoped correctly per Vercel environment
- [ ] `npm run db:generate` reviewed and committed, `npm run db:migrate` applied to production
- [ ] `AUTH_SECRET` and `CRON_SECRET` generated and set (not the `.env.example` placeholders)
- [ ] `AUTH_URL` set to the real production URL
- [ ] HubSpot Private App created with exactly the scopes in §3; `HUBSPOT_ACCESS_TOKEN` and `HUBSPOT_PROJECT_OBJECT_TYPE` set
- [ ] Google service account created, Drive root folder shared with its `client_email`; `GOOGLE_SERVICE_ACCOUNT_JSON_B64` set
- [ ] Resend domain verified (DKIM + DMARC); `RESEND_API_KEY` and `EMAIL_FROM` set
- [ ] At least one assistant provider API key set
- [ ] `ADMIN_BOOTSTRAP_EMAIL` set, `npm run db:seed` run against production
- [ ] First admin signed in and TOTP enrolled at `/admin/security`
- [ ] `vercel.json` crons visible and green in the Vercel dashboard; a manual sync run from `/admin/health` shows `status: ok`
- [ ] Handbook uploaded and made active at `/admin/handbook`
- [ ] Assistant provider/model chosen at `/admin/assistant`
- [ ] A real author invited end-to-end (magic link arrives, dashboard shows their book) before wider rollout
- [ ] (Optional) Author uploads: second service account created, uploads root folder shared with it as Editor, `GOOGLE_UPLOADS_SERVICE_ACCOUNT_JSON_B64` / `GOOGLE_UPLOADS_ROOT_FOLDER_ID` / `UPLOADS_NOTIFY_EMAIL` set — see §11
