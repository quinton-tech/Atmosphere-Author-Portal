# Security review — Atmosphere Author Portal

Scope: session/auth (`src/lib/session.ts`, `src/auth.ts`, `src/proxy.ts`, `src/lib/auth/*`),
data-access scoping (`src/lib/data/books.ts`), all `(author)` pages and `api/**` routes, every
admin `actions.ts` + `_integrations.ts`, `src/lib/drive/admin.ts`, `src/lib/hubspot/contact-info.ts`,
and `src/lib/assistant/*.ts`. Reviewed against the hard rules in `CLAUDE.md`: one author sees one
author's data, HubSpot writes confined to `writes.ts`/`client.ts`, admin checks server-side.

Findings are ordered by severity. Each fixed item is marked **FIXED** with the file(s) changed;
everything else is a recommendation only (see "What's not fixed" at the end for why).

---

## High

### H1. Open redirect on `?next=` via a leading-backslash bypass — **FIXED**

**Files:** `src/app/(auth)/sign-in/actions.ts:19-23`, `src/app/(auth)/sign-in/page.tsx:8-10`

Both copies of `safeNext()` only rejected values starting with `//`:

```ts
return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
```

Per the WHATWG URL spec, when a browser resolves a *relative* reference against the current
origin, a leading backslash is treated the same as a second forward slash for `http(s)` URLs —
`"/\evil.example"` parses as `"//evil.example"`, i.e. protocol-relative to `evil.example`. The
check above lets that value straight through (`"/\evil.example".startsWith("//")` is `false`).

**Concrete scenario:** an attacker sends `https://portal.example.com/sign-in?next=%2F%5Cevil.example`
(`%5C` = `\`). The victim opens the real, correctly-hosted sign-in page and signs in with their
password. `signInWithPasswordAction` finishes with `redirect(safeNext(formData.get("next")))` —
this is a bare `next/navigation` redirect, not routed through Auth.js's own redirect callback (that
callback *would* have neutralized this by prefixing `baseUrl`, since NextAuth's default callback
only trusts values it built itself, not raw client input for the credentials path taken here) — so
the browser receives a same-origin-looking Location header that it resolves off-origin, sending the
freshly-authenticated user to `evil.example` immediately after a real login. That's a strong
phishing primitive: the initial link and the login screen are 100% legitimate, only the post-login
hop is attacker-controlled.

**Fix applied:** both `safeNext()` copies now also reject any value containing a backslash:

```ts
return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/dashboard";
```

`verify-2fa`'s `safeAdminNext` (`src/app/(auth)/verify-2fa/actions.ts:13-16`,
`src/app/(auth)/verify-2fa/page.tsx:13`) was checked too — it requires an exact `"/admin"` prefix,
which a backslash can't satisfy, so it was not vulnerable and was left as-is.

---

## Medium

### M1. Admin book actions accepted `bookId` without checking it belongs to the target author — **FIXED**

**File:** `src/app/admin/authors/[id]/actions.ts` — `addNoteAction`, `linkFolderAction`,
`setFileVisibilityAction` (originally lines 17-39, 54-65, 67-95)

Each action takes `(userId, bookId, ...)` bound from hidden form fields on `/admin/authors/[id]`
and used `bookId` directly (`notes.bookId`, `setFileVisibility(bid, …)`, `linkFolder(bid, …)`)
without ever checking that `bookId` is actually one of `userId`'s books — exactly the pattern
CLAUDE.md's hard rule calls out ("No route may accept a book id without an ownership check").
The admin UI itself always passes a matched pair today, so this wasn't reachable through normal
use, but nothing enforced the pairing server-side: a modified form submission (or a future caller
of these exported actions) could add a note, relink a Drive folder, or toggle file visibility
against a book that doesn't belong to the author whose page it appears to be scoped to — the
`audit_log` row would then also misrepresent which author's data was touched.

**Fix applied:** added `assertBookBelongsToAuthor(userId, bookId)`, which reuses the
already-existing, already-scoped `getBookRowForAuthor` from `./queries.ts` (no new query logic)
and redirects with a flash error if the pair doesn't match. Called first thing in all three
actions.

### M2. `view-as` cookie set without the `secure` flag — **FIXED**

**File:** `src/app/admin/authors/actions.ts` — `viewAsAction` (was line 95)

Every other auth-adjacent cookie in the app (`authjs.session-token` in
`src/lib/auth/db-session.ts:39-46`, `ap_2fa` in `src/lib/auth/db-session.ts:57-63`) is set with
`secure: secureCookiesEnabled()`. The `ap_view_as` cookie — which lets an admin session read
another user's book/file/chat data via `effectiveUserId()` — was set with only
`{ httpOnly: true, sameSite: "lax", path: "/" }`, no `secure`. In production that's an
inconsistency with the app's own baseline: the cookie could be sent over a plaintext connection
(e.g. HTTP before an HSTS redirect completes, or a misconfigured proxy hop) and is more exposed to
network interception/downgrade than it needs to be, even though the practical exploit path (an
attacker who can intercept traffic could arguably already ride the session cookie itself) is
narrow.

**Fix applied:** now sets `secure: secureCookiesEnabled()`, matching the other two cookies.

### M3. No rate limit on the unauthenticated password-reset-request endpoint — **FIXED**

**Files:** `src/lib/auth/password.ts:29-42` (`requestPasswordReset`),
`src/app/(auth)/forgot-password/actions.ts` (`requestPasswordResetAction`)

Login (`isLoginRateLimited`, 10/15min) has a rate limit; `requestPasswordReset` had none. It's
unauthenticated, takes only an email, and on every call for a real account: sends a transactional
email via Resend, and (on the eventual `resetPassword`/`setPassword` call) triggers an HIBP range
lookup. An attacker could script repeated POSTs to `/forgot-password` with any author's address to
mail-bomb them, or drive up outbound call volume — with 15,000-20,000 authors at target scale this
is a real availability/cost surface, not just annoyance.

**Fix applied:** added `isPasswordResetRateLimited` to `src/lib/auth/rate-limit.ts` (same
`createRateLimiter` factory already used and tested for login: 5/hour per email, 20/hour per IP)
and wired it into `requestPasswordResetAction`. On a rate-limited request the action returns the
same `{ submitted: true }` shape as success, preserving the existing no-enumeration guarantee.

### M4. No lockout on admin TOTP verification — **FIXED**

**File:** `src/app/(auth)/verify-2fa/actions.ts` (`verifyTwoFactorCodeAction`)

A TOTP code is 6 digits (10^6 space) and `verifyTotpCode` accepts a ±30s drift window (`src/lib/auth/totp.ts:39`,
`epochTolerance: [30, 30]`), so up to 3 codes are valid at any instant. There was no limit on
verification attempts — an attacker who already has an admin's primary session (e.g. a stolen
session cookie, or `db-session` cookie replay) but not their authenticator could brute-force the
gate with no lockout.

**Fix applied:** added `isTotpRateLimited` to `src/lib/auth/rate-limit.ts` (10 attempts/15min per
already-authenticated admin user id) and checked it first in `verifyTwoFactorCodeAction`, before
touching the DB or the TOTP secret.

---

## Low

### L1. `CRON_SECRET` compared with `!==` (not constant-time) — **FIXED**

**File:** `src/app/api/cron/sync/route.ts:19-21` (original)

```ts
if (authHeader !== `Bearer ${env.CRON_SECRET}`) return unauthorized();
```

String `!==` short-circuits on the first mismatched byte, which is a classic (if hard-to-exploit
over a real network, given jitter) timing side channel for guessing a secret byte-by-byte. Low
severity — `CRON_SECRET` is `min(8)` chars and this endpoint isn't otherwise exposed — but cheap
to close.

**Fix applied:** added `isValidCronAuth()` using `node:crypto`'s `timingSafeEqual`, with a
length check first (required by `timingSafeEqual`, and itself constant-time-irrelevant since
length alone isn't the secret).

### L2. `proxy.ts` matcher doesn't cover `/api/files/*` or `/api/chat/*` — not fixed, mitigated by tests

**File:** `src/proxy.ts:55-57`

```ts
export const config = {
  matcher: ["/dashboard/:path*", "/books/:path*", "/account/:path*", "/admin/:path*"],
};
```

Both `/api/files/[id]` (and its `thumbnail` route) and `/api/chat` (and `/api/chat/rate`) sit
outside this matcher and rely entirely on their own `requireUser()` call for authentication —
which they currently do correctly (`src/app/api/files/[id]/route.ts:17`,
`src/app/api/files/[id]/thumbnail/route.ts:15`, `src/app/api/chat/route.ts:48`,
`src/app/api/chat/rate/route.ts:16`). This isn't a live bug today, but it means the proxy provides
no defense-in-depth for these routes: a new route added under `/api/` that forgets its own
`requireUser()`/`currentUser()` call would be completely unauthenticated, with nothing at the
edge to catch it.

**Recommendation:** either widen the matcher to include `/api/files/:path*` and `/api/chat/:path*`,
or accept the current design (explicit per-route checks) and rely on the new structural test
(`src/lib/security.guard.test.ts`, "author-facing pages and routes check the signed-in session")
to fail CI the moment a `page.tsx`/`route.ts` under `(author)/`, `api/files/`, or `api/chat/` stops
importing `@/lib/session`. Not changed here because widening the matcher is a routing/behavior
change with broader blast radius than the "clear, low-risk" bugs this pass fixes directly.

### L3. Password-login timing reveals account existence — not fixed

**File:** `src/lib/auth/password.ts:137-143` (`verifyPasswordLogin`)

```ts
export async function verifyPasswordLogin(email: string, password: string): Promise<AuthenticatedUser | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim())).limit(1);
  if (!user || user.disabledAt || !user.passwordHash) return null;
  const ok = await verifyPasswordHash(user.passwordHash, password);
  ...
}
```

For a non-existent (or password-less) account this returns immediately; for a real account it
runs a full Argon2id verification first, which is deliberately slow. The response-time gap lets an
attacker distinguish "no such account" from "wrong password" by timing alone, despite the UI
showing an identical "Invalid email or password" message either way — undermining the same
no-enumeration goal the magic-link path (`src/auth.ts:59-66`) and the password-reset path
(`src/lib/auth/password.ts:29-42`) both explicitly implement.

**Recommendation:** on the not-found path, run `verifyPasswordHash` against a fixed dummy hash
(generated once at module load, never a real user's hash) before returning `null`, so both paths
pay the same Argon2id cost. Not applied here: it touches the auth-critical verify path and is more
than a mechanical fix (needs a real dummy hash, and care that its parameters track
`hashPassword`'s), so it's flagged for a deliberate follow-up rather than folded into this pass.

### L4. Chat history lets the client assert fake "assistant" turns — informational, not fixed

**File:** `src/app/api/chat/route.ts:95-99`

```ts
const history: ChatTurn[] = modelMessages
  .slice(0, -1)
  .filter((m): m is ModelMessage & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
  .slice(-HISTORY_TURNS)
  .map((m) => ({ role: m.role, content: modelMessageText(m) }));
```

The `messages` array in the request body is entirely client-supplied (it's `useChat`'s local
message list, POSTed back each turn) and its `role` field is trusted as-is when building the
prompt sent to the model. A user could hand-craft a request containing synthetic prior
`"assistant"` turns to try to talk the model out of its system-prompt constraints (a standard
prompt-injection technique). Impact is low here: the model has no tools/actions, the handbook
content isn't confidential, and — critically — this can only affect the attacker's own
conversation, not another author's data (the `bookId`/`userId` used for the DB write and any
book-specific context are still derived server-side from the session, not from the message
content). Documented as a known, accepted surface rather than fixed.

### L5. Book title / stage label interpolated into the system prompt unescaped — informational, not fixed

**File:** `src/lib/assistant/prompt.ts:73-80`

`bookTitle` and `stageLabel` come from HubSpot-synced, staff-entered data and are spliced directly
into a `system` message (`Book: ${input.bookTitle}.`) with no delimiting/escaping against the
handbook block or the rest of the system prompt. A malicious or compromised HubSpot property value
could inject instruction-like text at a point the model is more likely to trust ("system" role).
Low severity: the field is staff-controlled (not author- or public-facing input), and the blast
radius is the same single conversation as L4. Worth a delimiter (e.g. wrapping in an XML-ish tag)
if HubSpot data entry is ever opened up further, but not fixed in this pass.

---

## What's verified clean (no finding)

- **Ownership scoping (`src/lib/data/books.ts`):** every export takes `userId` and scopes its
  query with `eq(books.userId, userId)` (or a join through `books`) — `getBookForUser`,
  `listBooksForUser`, `getAuthorInfoForUser`, `getVisibleFileForUser`, `defaultBookIdForUser`.
  There's no `getBookById(id)` without a `userId`, matching the CLAUDE.md rule. All four
  `(author)` pages and both `api/files/*` routes call `requireUser()` + `effectiveUserId()` and
  pass the result into these helpers before rendering/streaming anything.
- **`effectiveUserId`/view-as gating (`src/lib/session.ts:22-33`):** the `ap_view_as` cookie is
  only ever honored when `session.user.role === "admin"` — a non-admin who manually sets the
  cookie (it's `httpOnly`, so not settable via page JS, but is settable via devtools/curl on their
  own browser) gets `base` back unchanged; the cookie value is also re-validated against the
  `users` table on every read, so a stale/deleted target id silently falls back to the admin's own
  identity rather than erroring into anything exploitable.
- **Admin `requireAdmin()` coverage:** every exported function in every
  `src/app/admin/**/actions.ts` file calls `requireAdmin()` (confirmed by grep and now enforced by
  `security.guard.test.ts`), and `src/app/admin/layout.tsx:7` additionally calls it for the whole
  subtree. `src/proxy.ts:29-42` gates `/admin/*` at the edge too (role check, then a TOTP-enrolled
  gate, then the `ap_2fa` HMAC cookie), so admin access is checked at three independent layers.
- **2FA cookie construction (`src/lib/auth/cookies.ts:32-47`):** `signTwoFactorCookie` is an HMAC-SHA256
  over `${sessionToken}:${dayStamp}` keyed by `AUTH_SECRET`, so it can't be forged without the
  server secret, is bound to one specific session token (can't be replayed against a different
  session/user), and self-expires at UTC midnight without needing a DB check. Verification
  (`isTwoFactorCookieValid`) uses `timingSafeEqual` with a length check first.
- **Magic-link / reset-token handling:** the Resend `sendVerificationRequest`
  (`src/auth.ts:59-66`) and `requestPasswordReset` (`src/lib/auth/password.ts:29-42`) both look up
  the user, both silently no-op for a missing/disabled account, and both always show the caller
  the same success UI either way — no enumeration oracle in the response shape (only in the timing
  side channel noted as L3, which is on the *login* path, not these two).
- **File proxy (`src/app/api/files/[id]/route.ts`, `.../thumbnail/route.ts`):** ownership-checked
  via `getVisibleFileForUser` before any Drive call, 404 (never 403) on any failure mode (unknown
  id, wrong owner, Drive object gone) so the response never confirms which, sets
  `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. `contentDisposition()`
  (`src/lib/drive/mime.ts`) strips control characters, escapes header-unsafe characters, and
  produces both an ASCII `filename` fallback and an RFC 5987 `filename*` — no header injection via
  a crafted file label.
- **Chat rating endpoint (`src/app/api/chat/rate/route.ts`):** the `UPDATE` is
  `and(eq(chatMessages.id, messageId), eq(chatMessages.userId, userId))` — scoped, and returns 404
  (not 403) on no match, consistent with the file-proxy convention.
- **Chat per-user cap (`src/app/api/chat/route.ts:58-69`):** counted from `chat_messages` where
  `userId = effectiveUserId(user)` and `createdAt >= startOfDayUtc`, so an admin viewing-as an
  author is correctly charged against *that author's* daily count, not the admin's.
- **HubSpot write surface:** `src/lib/hubspot/contact-info.ts` (the only caller of
  `getHubSpotWriter()` outside `writes.ts`/`client.ts`) only calls the narrow
  `updateContactProperties`/`updateProjectProperties` interface methods defined in `writes.ts` —
  it never touches the underlying `@hubspot/api-client` SDK directly. The existing
  `writes.test.ts` "hubspot write guard" test (regex over `basicApi|batchApi|associationsApi` /
  `crm.objects`/`crm.contacts` mutating calls) confirms no other file in `src/` does either.
  Throttling (5/day via a rolling 24h `audit_log` count,
  `src/lib/hubspot/contact-info.ts:72-80`), zod validation (`contactInfoSchema`), write-then-mirror
  ordering, and before/after audit all match the CLAUDE.md brief.
- **Secrets/vendor code reaching the client:** every `"use client"` file in `src/` was checked —
  none import `@/lib/env`, `@/db`, `@/auth`, or any `server-only`-guarded module (now enforced by
  `security.guard.test.ts`).
- **Drive read-only enforcement (`src/lib/drive/client.ts:16`,
  `src/lib/drive/admin.ts`):** the service-account JWT is scoped to
  `drive.readonly`; `admin.ts`'s only writes are to the app's own `visible_files`/`books` rows, and
  every mutation there is called through `_integrations.ts`, which puts `requireAdmin()` in front
  of each one (`src/app/admin/_integrations.ts:34-46`).

---

## Structural guard tests added

`src/lib/security.guard.test.ts` (vitest, no DB, path/regex-based only):

1. Every `src/app/admin/**/actions.ts` file contains `requireAdmin(`.
2. Every `page.tsx`/`route.ts` under `src/app/(author)/`, `src/app/api/files/`, and
   `src/app/api/chat/` imports from `"@/lib/session"`, or carries a
   `// security-guard-allow: <reason>` comment.
3. No `"use client"` file imports `"@/lib/env"`, `"@/db"`, or `"@/auth"`.
4. References (does not duplicate) the existing HubSpot mutating-call allow-list guard in
   `src/lib/hubspot/writes.test.ts` ("hubspot write guard" describe block) by asserting that file
   still exists and still contains that check.

Each glob-based `describe` block also has its own "found at least one file" sanity test, so a
future refactor that accidentally empties a glob (e.g. a directory rename) fails loudly instead of
the guard silently passing on zero files.

Run: `npm test` (all 111 pre-existing tests + 34 new ones pass) and `npm run typecheck` (clean).

---

## What's not fixed here, and needs a live-DB / integration test to actually prove

- **M1's real guarantee** — that `getBookRowForAuthor`/`getBookForUser` truly filter by
  `userId` at the SQL level, and that a cross-author `bookId` genuinely yields zero rows — is only
  exercised end-to-end with a real Postgres instance and seeded data for two authors. The guard
  test suite here is structural (imports/calls present) by design (per the task's "no DB"
  constraint); it cannot prove the *runtime* boundary holds. Recommend an integration test seeding
  two users with one book each and asserting `getBookForUser(userB.id, bookA.id)` returns `null`,
  and that `POST /api/files/[bookA's fileId]` as userB returns 404, and the same for
  `addNoteAction`/`linkFolderAction`/`setFileVisibilityAction` now that M1 is fixed.
- **The view-as boundary end-to-end** — that `currentUser()` really can't be tricked into
  resolving `viewingAs` for a non-admin, across a real signed-in session with a real cookie jar,
  including the case where an admin is demoted mid-session or the target user is deleted mid-view.
- **Rate limiters (M3, M4, and the pre-existing login limiter)** are in-memory and per-process
  (documented as such in `src/lib/auth/rate-limit.ts`) — they reset on deploy and don't share state
  across instances. Fine at today's single-process scale; needs a shared store (Redis/Upstash)
  plus a test against that store before this app runs multi-instance, per the file's own comment.
- **The `writes.guard.test.ts` regex** is a static-analysis allow-list, not a runtime guarantee —
  it would miss a mutating call built dynamically (e.g. via a computed method name) rather than
  written literally as `client.crm.contacts.basicApi.update(...)`. Low likelihood given the small,
  reviewed surface, but worth knowing the limit of what that test actually proves.
