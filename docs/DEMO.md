# Demo mode

A "crazy light" preview of the portal — Vercel Hobby + a free Neon database, one fixture author,
**no HubSpot, Google Drive, or LLM credentials required.** Useful for showing the UI to someone
without provisioning real integrations, or as a scratch environment to poke at without touching
production data.

Demo mode is gated entirely by one env var, `DEMO_MODE` (`src/lib/env.ts`). When it's set:

- `GET /api/cron/sync` returns `200 { "skipped": "demo mode" }` immediately instead of calling
  HubSpot (`src/app/api/cron/sync/route.ts`) — safe to leave `vercel.json`'s crons enabled, they'll
  just no-op.
- `getDriveReader()` (`src/lib/drive/client.ts`) returns `FixtureDriveReader`
  (`src/lib/drive/fixture.ts`) instead of the real Google Drive client. It serves two small,
  checked-in files from `public/demo/` — `cover.svg` and `blurb.pdf` — under fixture ids
  `demo-cover` / `demo-blurb` and folder id `demo-folder`. No `GOOGLE_SERVICE_ACCOUNT_JSON_B64`
  needed. `demo-folder` sits under the fixture author folder id `demo-author-folder` (the demo
  author's own subfolder, per the one-folder-per-author model in `docs/DEPLOY.md` §4), seeded onto
  `users.driveFolderId` for the demo author by `linkDemoAuthorFolder` in `src/db/seed-demo.ts`.
- An author's own Account-page contact info edit (`src/lib/hubspot/contact-info.ts`) skips the
  HubSpot write and only updates the local cache + audit log, so that form still works without
  `HUBSPOT_ACCESS_TOKEN`.
- `npm run db:seed -- --demo` (or just running `npm run db:seed` with `DEMO_MODE` already set)
  additionally seeds one fixture admin and one fixture author with two books — see below.

Nothing else changes: the rest of the app (sign-in, dashboard, timeline, files, account, admin,
assistant) runs exactly as in production, just against fixture data.

## Run it locally

1. Install dependencies as usual (`npm install`) and get a Postgres your local `DATABASE_URL` can
   reach — either a free Neon branch (fastest, see below) or any local Postgres.
2. Copy `.env.example` to `.env` and fill in:

   ```bash
   DATABASE_URL=postgres://...           # your Neon/local Postgres
   AUTH_SECRET=$(openssl rand -base64 32)
   CRON_SECRET=$(openssl rand -hex 32)
   DEMO_MODE=1
   ```

   Everything else in `.env.example` (HubSpot, Drive, Resend, the three assistant provider keys)
   can stay blank. If you want the assistant chat to actually answer questions instead of just
   showing the handbook as unavailable, set **one** of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
   `GOOGLE_GENERATIVE_AI_API_KEY` — see "What's stubbed" below.

3. Push the schema and seed the demo fixtures:

   ```bash
   npm run db:push
   npm run db:seed -- --demo
   ```

   `db:seed` without `-- --demo` still works and is still idempotent — it just skips the fixture
   author (see `src/db/seed-demo.ts`). Re-running `db:seed -- --demo` any number of times is safe;
   it will not duplicate rows or clobber a handbook you've since made active from `/admin/handbook`.

4. `npm run dev`, then sign in at `http://localhost:3000/sign-in` with either login below (use the
   **password** field, not the magic-link email field — Resend isn't configured in demo mode).

## Demo logins

| Role | Email | Password |
|---|---|---|
| Admin | `admin@demo.atmospherepress.test` | `demo-admin-pass-123` |
| Author | `maya@demo.atmospherepress.test` | `demo-author-pass-123` |

The author is "Maya Okafor" with two books:

- **The Orchard at Dusk** — mid-production, currently in Interior Design, with a full team
  (BPM/PBC/AE/DE/PR/CD/ID), a completed developmental edit and proofread, an approved cover, a
  "Pay now" action item (an unpaid installment), two visible files (a cover and a back-cover
  blurb), and a note about an upcoming interior proof.
- **Small Hours** — early-stage, in Developmental Editing, DE assigned a few weeks ago and still
  "in progress." No cover or interior work has started, and it has no visible files — a check that
  the UI holds up for a book that's mostly a shell.

Full fixture data lives in `src/db/demo-data.ts`; the seeding logic (idempotent) is in
`src/db/seed-demo.ts`.

## Deploy to Vercel Hobby + Neon free tier

1. **Neon**: create a free project (one branch is enough for a demo — skip the separate
   preview-branch setup `docs/DEPLOY.md` describes for production). Copy its pooled connection
   string.
2. **Vercel**: import the repo as a new project on the Hobby plan.
3. Set these environment variables (Project → Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled connection string |
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `CRON_SECRET` | `openssl rand -hex 32` (Vercel Cron needs this even though sync is skipped) |
   | `DEMO_MODE` | `1` |
   | `AUTH_URL` | your Vercel deployment URL, e.g. `https://your-demo.vercel.app` |

   Optionally add one assistant provider key (see "What's stubbed" below). Leave
   `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PROJECT_OBJECT_TYPE`, `GOOGLE_SERVICE_ACCOUNT_JSON_B64`,
   `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `RESEND_API_KEY`, and `ADMIN_BOOTSTRAP_EMAIL` unset.

4. Deploy. Vercel Hobby's cron minimum interval is once a day, which doesn't match
   `vercel.json`'s `*/10 * * * *` / `15 3 * * *` schedule for a paid plan — either edit
   `vercel.json` to a once-daily schedule before deploying to Hobby, or just remove the `crons`
   block entirely, since demo mode makes every cron hit an immediate no-op anyway.
5. From your local machine (with `.env` pointed at the same `DATABASE_URL` as the Vercel deploy),
   run once:

   ```bash
   npm run db:push
   npm run db:seed -- --demo
   ```

   (There's no build-time hook that runs these automatically — do it by hand, or wire a one-off
   `vercel env pull` + the two commands above into a deploy script if you'll be redeploying often.)
6. Visit the deployed URL and sign in with either demo login above.

## What works

- Sign-in (password), sessions, sign-out.
- Author dashboard, book detail, timeline, team, action items (including the seeded "Pay now"
  item), files list and file/thumbnail streaming (from the two `public/demo/` fixtures), notes.
- Account page, including editing your own contact info (writes to the cache only, see above).
- Full `/admin` panel: books, authors, stages, labels, rules, health, log — all read/write against
  Postgres, none of it depends on HubSpot or Drive being real.
- The assistant chat, **if** you set one LLM provider key — it answers from the seeded
  `src/db/demo-handbook.md` (ingested and activated by the demo seed), citing its sections.

## What's stubbed / doesn't apply

- **HubSpot sync** never runs; there's nothing to reconcile against, since the fixture data is
  written directly. `/admin/health`'s sync-run history will stay empty, and its "Run incremental
  sync" / "Run full sync" buttons will just hit the demo no-op.
- **Google Drive** is two files, not a real folder tree — the author's "Your files" page (`/files`)
  and the admin folder browser (`/admin/authors/[id]`) will only ever show `demo-author-folder` →
  `demo-folder`'s two fixture files for book 1, and nothing under book 2 (it has no `driveFolderId`
  of its own — see the master-folder model in `docs/DEPLOY.md` §4).
- **Magic-link sign-in** doesn't work (no `RESEND_API_KEY`) — always use the password field on
  `/sign-in`. Password reset email likewise won't send; both demo accounts already have passwords,
  so this shouldn't come up.
- **The assistant** returns "not in handbook" / stays unconfigured unless you set an LLM provider
  key — the handbook content and citations are real (seeded from `src/db/demo-handbook.md`), only
  the model call itself needs a credential.
- **TOTP enrollment** still applies to the demo admin the same as production — visiting `/admin`
  the first time will prompt for it, same as `docs/DEPLOY.md` §8.
