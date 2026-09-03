# Runbooks

Each entry: symptom → check → fix. Verified against the current code, not memory.

## a. HubSpot token rotation

**Symptom**: You're rotating `HUBSPOT_ACCESS_TOKEN` proactively (expiry, security policy), or sync has started failing with 401s from HubSpot.

**Check**:
- `/admin/health` → "Last 20 sync runs" — a run with `status: error` and a HubSpot auth error in its `errors` column confirms it's the token.
- Confirm in HubSpot (Settings → Integrations → Private Apps) whether the app/token is still active.

**Fix**:
1. In HubSpot, generate a new token for the same Private App (or create a replacement app with the same scopes listed in `docs/DEPLOY.md` §3: `crm.objects.contacts.read`, `crm.objects.custom.read`, `crm.schemas.custom.read`, plus the one write scope for contact-info updates).
2. Update `HUBSPOT_ACCESS_TOKEN` in Vercel's environment variables (Production, and Preview if you use HubSpot there too).
3. Redeploy (env var changes require a redeploy to take effect for existing deployments) — or trigger a new deployment from Vercel.
4. Confirm with a manual sync: `/admin/health` → "Run incremental sync", then check the new row shows `status: ok`. `src/lib/hubspot/client.ts` caches nothing about the token itself (the client is a singleton built once per process from `env.HUBSPOT_ACCESS_TOKEN`), so a fresh deploy is what actually picks up the new value — there's no separate cache to bust.

## b. Sync stuck or failing

**Symptom**: `/admin/health` shows a sync run stuck at `status: running` for a long time, or repeated `status: error` rows, or the "Unresolved properties" / "Unmapped stages" counts are climbing.

**Check**:
1. `/admin/health` → "Last 20 sync runs" table: `status`, `processed/created/updated/unmatched`, and the `errors` column (a badge with a count — the actual messages are the `errors` array on that `sync_runs` row, visible via `npm run db:studio` if you need the full text).
2. Where cursors live: `runIncrementalSync` computes `since` from the most recent **successful** run's `cursorUpdatedAt` (5-minute overlap) — see `computeIncrementalSince()` in `src/lib/hubspot/sync.ts`. A full or incremental run **in progress** (not yet finished, e.g. resuming across a nightly full sync's ~200 pages) keeps its HubSpot pagination cursor in `app_settings`, under the key `hubspot:incrementalSyncCursor` or `hubspot:fullSyncCursor` (see `resumeKey()` in `src/lib/hubspot/sync.ts`) — not on the `sync_runs` row itself, because that table has no text column for a page token. This key is deleted automatically once a run finishes (`done: true`) or hard-errors; if a run is genuinely stuck (crashed mid-page with no error recorded, e.g. a Vercel function timeout that never returned), the resume key can be left behind and the next cron tick will pick up where it left off rather than starting fresh.
3. Vercel → Project → Logs, filtered to `/api/cron/sync`, for the actual invocation failures (timeouts, cold-start errors) that wouldn't show up as a HubSpot-side error message.

**Fix**:
- **A single failed run with a clear HubSpot error** (rate limit exhaustion after 5 retries, a schema/property error, auth failure): fix the underlying cause (see runbook a for auth), then trigger a fresh run from `/admin/health` — "Run incremental sync" or "Run full sync". A hard error already clears the resume cursor (`runPagedSync` deletes the `app_settings` key on any error), so the next run starts clean rather than looping on the same broken page.
- **A run stuck at `running` with no error and no progress for well past its expected window** (10+ minutes for incremental, well past the nightly window for full): this means an invocation died without the route handler completing — the resume cursor in `app_settings` is probably still there. You can:
  - Do nothing and wait for the next scheduled cron tick — `runPagedSync` will read the existing `app_settings` resume key and continue from that page automatically.
  - Or clear it manually via `npm run db:studio`: delete the `app_settings` row with key `hubspot:incrementalSyncCursor` (or `hubspot:fullSyncCursor`), which forces the next run to start over from the last **successful** run's cursor instead of resuming a possibly-corrupt in-progress one. Note this does not touch the stale `sync_runs` row still showing `status: running` — that row is just history and can be left as-is or noted.
- **To trigger a sync outside the schedule**: `/admin/health` buttons (above), or from the CLI: `npm run sync:hubspot -- --kind=full` (or `--kind=incremental`, the default).
- **`unmatched` count is high**: means Projects came back from HubSpot with no associated Contact email — check the HubSpot side (Project missing a Contact association, or the Contact missing an email). These are counted but not treated as errors.
- **"Unresolved properties" / "Unmapped stages" on Health**: not a sync failure — see runbook (f) for stage mapping specifically. Unresolved properties means a portal property in `src/lib/hubspot/properties.ts` couldn't be matched by label to any property in the HubSpot Project schema; either the label changed in HubSpot or it needs an override in `app_settings.propertyMap`.

## c. Updating the handbook

**Symptom**: Routine — a new handbook revision needs to go live, or you want to verify one before making it active.

**Check/Fix**:
1. `/admin/handbook` → upload the new PDF or DOCX (25 MB max; `ingestHandbook` extracts text via `pdf-parse`/`mammoth`, splits into cited sections, and stores it as a new, **inactive** `handbook_versions` row — the currently active version keeps serving live traffic while you review the new one).
2. Use the "Test a question" box to ask a real author question against the specific new version (it does not need to be active to test) and check the answer and cited section ids look right.
3. When satisfied, click "Make active" on that version. `activateHandbook` flips exactly one version to active atomically (`db.batch`, deactivating the previous one in the same call) and invalidates the 60-second in-process cache immediately (`invalidateActiveHandbookCache()`), so new chat requests pick it up right away — no redeploy needed. Every upload and activation is audited (`admin.handbook.upload`, `admin.handbook.activate`).
4. **Rollback**: there's no dedicated "revert" button — a rollback is just activating the previous version again. `/admin/handbook`'s version list shows every prior version with its upload date; click "Make active" on the one you want to restore. Nothing is ever deleted, so any past version can be re-activated at any time.

## d. Switching the assistant model or provider, and reading the eval

**Symptom**: You want to change which LLM answers author questions, or evaluate a candidate model before switching.

**Check**: `/admin/assistant` only lists providers that have an API key configured in the environment (`configuredProviders()` in `src/lib/env.ts`) — if a provider you expect is missing, its key isn't set (see `docs/DEPLOY.md` §2).

**Fix — switching**:
1. `/admin/assistant` → choose provider + model from the dropdown, save. This writes `{ provider, model }` to `app_settings.assistant` and is audited (`admin.assistant.settings`). Takes effect on the next chat request — `getActiveModel()` reads this setting fresh on every call, no caching to bust.
2. If nothing is saved yet (or the saved provider loses its API key), the app falls back to the first configured provider and its flagship curated model — see `CURATED_MODELS` in `src/lib/assistant/providers.ts`.

**Running the eval**:
```bash
npm run assistant:eval -- --provider=anthropic
```
Omit `--provider` to run every configured provider; add `--model=<id>` to pin a specific model instead of each provider's default. It runs every case in `src/lib/assistant/eval/cases.json` against the active handbook, grades each answer (contains the expected keywords, and cites at least one expected section when `expectedSections` is non-empty), and prints a table of pass rate, average latency, and estimated cost per provider. Read the printed table directly in your terminal — there's no persisted eval history in the database; re-run it whenever you want a fresh comparison (e.g. before/after a handbook update, or before switching models). `/admin/assistant` also shows a log of real `chat_messages` filterable by rating (thumbs down) and `notInHandbook`, which is a better signal for how the model is doing in production than the eval's fixed case set alone — check both.

## e. An author can't log in

**Symptom**: An author reports they can't sign in.

**Check, in order**:
1. **Are they disabled?** `/admin/authors` search for their email; the row shows invited/disabled state. A `disabledAt` timestamp blocks both magic-link email (`sendVerificationRequest` in `src/auth.ts` silently no-ops for a disabled user — this is deliberate, to avoid confirming account existence to an outsider) and password login (`verifyPasswordLogin` in `src/lib/auth/password.ts` returns null for a disabled user).
2. **Were they ever invited?** If there's no user row at all yet, sign-in will silently do nothing (same no-enumeration behavior) — they need an invite first. `/admin/authors` → Invite (or, if the row exists but was never actually sent, Resend).
3. **Check spam/promotions** for the magic-link email — sent via Resend from `EMAIL_FROM`. If Resend's domain isn't fully verified (DKIM/DMARC — see `docs/DEPLOY.md` §5), deliverability to major providers (Gmail especially) suffers; check the Resend dashboard's activity log for that specific send (bounced, delivered, etc.).
4. **Magic link expired**: links are valid 15 minutes (`maxAge: 15 * 60` in `src/auth.ts`). Have them request a fresh one, or use "Resend" from `/admin/authors`.
5. **They use a password and it's wrong / they forgot it**: point them to `/forgot-password` (self-service — creates a 30-minute reset token, emails a reset link, no admin action needed). `requestPasswordReset` in `src/lib/auth/password.ts` also silently no-ops for a disabled or nonexistent account, so check step 1 first if they say the reset email never arrives either.
6. **Rate limited**: `src/auth.ts`'s Credentials provider calls `isLoginRateLimited(email, ip)` — 10 attempts per 15 minutes per email and per IP, in-memory (per server instance, resets on redeploy). If they've been hammering the password form, wait 15 minutes or trigger a redeploy to clear it.

**Fix (admin actions available from `/admin/authors`)**:
- **Invite** — creates the user row if missing and sends the magic link.
- **Resend** — re-sends the magic link; also clears `disabledAt` if they were previously revoked (re-inviting someone is treated as "let them back in").
- **Force sign-out** — deletes all their `sessions` rows (useful if they're stuck in a weird state, not specifically a login-failure fix).
- **Revoke** — the opposite of what you want here; only relevant if this is actually an access-removal request, not a stuck-login one (see runbook g).

## f. An author reports the wrong production stage

**Symptom**: An author says their dashboard shows the wrong stage for their book.

**Check**:
1. `/admin/authors/[id]` for that author → their book's raw cached properties (`getBookForUser(id, bookId, { includeProperties: true })`) — compare the raw `pipelineStage` value against what's actually set in HubSpot for that Project. If they match, the mismatch is in HubSpot itself (staff data-entry issue, not a portal bug) — fix it there and refresh (below).
2. If the raw value differs from HubSpot, or looks stale: check `book_cache.syncedAt` for that book (via the same admin detail page, or `npm run db:studio`) — if it's old, sync hasn't run recently for this Project; see runbook (b).
3. **Unmapped values**: `/admin/stages` shows "Unmapped values seen" — distinct raw `pipelineStage` values present in `book_cache` that no `stage_config` row's `hubspotValues` list claims (`listUnmappedStageValues()` in `src/app/admin/stages/queries.ts`). If the author's raw stage value shows up here, that's the bug: the portal has no friendly stage for it, so `getBookForUser` falls back to whatever `property_display` has for the raw `pipelineStage` value, or "In production" if even that's unset.

**Fix**:
- **Unmapped raw value**: `/admin/stages` → edit the appropriate stage row → add the raw value to its `hubspotValues` list (comma-separated in the UI). Takes effect immediately for any book already cached with that value — no re-sync needed, since stage resolution happens at read time from the cached raw properties, not baked in at sync time. (`bookCache.stageKey` is also written at sync time as a convenience/index; a fresh sync will pick up the new mapping too, but existing cached rows using the fallback code path in `getBookForUser`/`listBooksForUser` will resolve correctly right away.)
- **Stale cache**: `/admin/authors/[id]` → "Refresh from HubSpot" button on that author (calls `syncAuthor`, which re-pulls every Project associated with their HubSpot contact — including ones the portal doesn't know about yet, useful if they have a new book).
- **HubSpot itself is wrong**: not a portal fix — route to whoever maintains the HubSpot data (typically an Author Manager or ops).

## g. Revoking an admin

**Symptom**: An admin account needs to be demoted back to a regular author (offboarding, access review), or an admin's session needs killing immediately.

**Check**: There is currently **no admin-UI action to change a user's `role`** from admin to author. `/admin/authors` only exposes Invite / Resend / Revoke / Force sign-out / View as, all of which operate on `disabledAt` or `sessions`, not `role`. The only code path that sets `role: "admin"` is `db:seed`'s bootstrap logic, and it only ever promotes — it never demotes. This is a gap between the intended runbook and the current UI; flagged in this doc's own "code vs. expectations" note for the developer to close (e.g. a role toggle on `/admin/authors/[id]`).

**Fix, until that exists**:
- **To immediately cut off access** (most common actual need — "this person shouldn't have access anymore"): use **Revoke** on `/admin/authors` for that user. This sets `disabledAt` and deletes every `sessions` row for them (`revokeAccess` in `src/lib/auth/invite.ts`) — they can't sign in again, admin or not, until re-invited. This is almost always sufficient and is reversible (re-invite re-enables them).
- **To specifically demote admin → author while keeping their account active**: there's no UI for this yet. Do it directly against the database:

  ```bash
  npm run db:studio
  ```

  Open the `users` table, find the row by email, change `role` from `admin` to `author`, save. This does not by itself kill their existing session — if they're mid-session as an admin, pair it with **Force sign-out** on `/admin/authors` (or delete their `sessions` rows the same way in Studio) so the change takes effect immediately rather than at their next natural sign-in.
- Either way, note the change somewhere outside the app too (there's no `audit_log` entry for a manual Studio edit) — a direct database change bypasses `src/lib/audit.ts` entirely.

## h. Restoring the database (Neon point-in-time restore)

**Symptom**: Bad data got into production (a bad migration, an accidental bulk edit, corruption) and you need to restore to an earlier point.

**Check**: Confirm the target time window — Neon's point-in-time restore works from its write-ahead log history, which is retained for a limited window depending on your Neon plan (check Neon dashboard → project → Settings → Storage for your plan's retention). The further back you need to go, the more likely you're outside that window.

**Fix**:
1. In the Neon dashboard, go to your project → Branches.
2. Either restore the branch in place to a timestamp (Branches → your branch → "Restore" and pick a timestamp or LSN), or — safer — create a **new branch** from that point in time first, so you can inspect it before touching production. Neon supports both "restore" (in place) and "create branch from point in time."
3. If you created a new branch to inspect: verify the data looks right (spot-check via `npm run db:studio` pointed at that branch's connection string, or `psql`), then either promote that branch to replace `main` (Neon supports branch reset/swap) or copy the specific data back.
4. If you restored `main` in place: any writes between the restore point and now are gone. Because this app treats HubSpot as the source of truth for book/production data (`book_cache` is a cache, not the record of truth), a lost `book_cache`/`books` window is self-healing — trigger a full sync from `/admin/health` ("Run full sync") once the restore is done, and production data repopulates from HubSpot. Data that is **not** recoverable from HubSpot and only lives in Postgres — `users` (accounts, roles, password hashes), `stage_config`/`action_rules`/`property_display` (admin configuration), `handbook_versions`, `chat_messages`, `visible_files`, `audit_log` — is genuinely lost for that time window and needs the point-in-time restore to get back, or manual re-entry for small amounts of it (e.g. re-adding a stage mapping).
5. After any restore, check `/admin/health` for sync status and re-run a full sync if `book_cache` looks stale, and spot-check that admin accounts (`role: admin`, `totpEnabled`) came back correctly — you don't want to find out TOTP enrollment was rolled back when the next admin sign-in gets stuck.
