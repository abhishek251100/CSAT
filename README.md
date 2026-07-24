# Zoo Media CX Platform

Internal Customer Experience analytics and workflow platform for the Zoo Media agency network.

**[SPEC.md](SPEC.md) is authoritative.** Sections 4 (DB schema), 5 (RBAC), and 6 (metric formulas) are
non-negotiable contracts. Build order is Section 14.

**Guides:** [USER_GUIDE.md](USER_GUIDE.md) (operators) · [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) (engineering) · [DEMO_DATA.md](DEMO_DATA.md)

## Status

Milestone 7 of 12 complete — core views live; delivery overhaul adds Global scope, Foxy agency, three tabs (CX metrics / DSAT / A tracker), Access admin, and sticky filters.

1. ✅ Repo scaffold, end-to-end type flow, Zod-validated env, CI.
2. ✅ DB schema + migrations + enums + seed (§4, §13); metric functions in `packages/shared` (§6).
3. ✅ better-auth + memberships + scope resolver + tRPC auth/scope middleware (§5).
4. ✅ Manual response entry + `metric_rollups` recompute, on write and on a schedule (§4.3, §6).
5. ✅ CX metrics (formerly View 1) — rollups, Global/Network/Agency/Account, brand health (§9).
6. ✅ Escalations → RCA (5 Whys, fishbone, error category) → action items; DSAT-triggers-RCA (§8).
7. ✅ DSAT + A tracker tabs + Access (membership) admin.
8. ⬜ Google Sheets sync with per-account column mapping (§7.1).

Migrations are applied to Neon and the org hierarchy is seeded: 1 network (Zoo Media), agencies (The Starter Labs + Foxy + demo), TSL + Foxy accounts.

## Authentication (§5, §16 #4)

Two sign-in paths, and only two. There is **no open registration** and no signup page — users exist
only by invite or an explicit membership grant.

1. **Google SSO**, restricted to the `ALLOWED_EMAIL_DOMAINS` allowlist.
2. **One break-glass `super_admin`** on email and password, for when SSO itself is unavailable.
   Credentials come from env, never hardcoded, and it is exempt from the domain rule.

### Proven end to end, not just by unit tests

`pnpm --filter @zoo/web e2e` drives a real browser through the real OAuth callback with only Google's
endpoints stubbed, and asserts the gate at the HTTP boundary:

- `gmail.com` and `outlook.com` identities are **refused** — no session cookie, no session row, and
  the browser lands on a "not on an allowed domain" state, not the dashboard.
- `thestarterlabs.com` and `zoomedia.com` identities are **admitted** to the dashboard with a session.

The harness ([apps/api/e2e/oauth-test-server.ts](apps/api/e2e/oauth-test-server.ts)) runs the real
`createApp` over in-process Postgres and stubs exactly one thing — Google's token endpoint — by
patching `globalThis.fetch`. In the callback path better-auth only exchanges the code for tokens and
then _decodes_ (never verifies) the id_token, so returning an id_token carrying any email injects
that identity; the domain gate runs unmodified. `undici`'s MockAgent does **not** work here — Node's
built-in `fetch` uses its own bundled undici, so `setGlobalDispatcher` has no effect and the request
escapes to the real Google. The browser's trip to the consent screen is stubbed by a Playwright
route. Runs in CI with no Neon connection.

### The allowlist is the entire domain wall

The OAuth consent screen is configured as **External**. Any Google account — personal `gmail.com`
included — can reach consent, complete the handshake, and arrive with a valid, verified identity.
Nothing upstream filters by organisation.

So `ALLOWED_EMAIL_DOMAINS` is not defence in depth; it is the wall. That drives three choices:

- **Strict parsing, fail-fast.** An empty or malformed value refuses the boot rather than being
  coerced. A permissive parse would silently widen the allowlist; silently skipping a bad entry
  would narrow it and lock people out. Both are worse than not starting.
- **Exact set membership, never suffix matching.** `notthestarterlabs.com` and `evil.zoomedia.com`
  are unrelated registrations and are rejected. Subdomains are not implied.
- **ASCII-only domains.** Rules out IDN homograph lookalikes (a Cyrillic `о` in `zоomedia.com`)
  that would be indistinguishable in a `.env` file. Add punycode if a real IDN is ever needed.

Set it in every environment:

```
ALLOWED_EMAIL_DOMAINS=thestarterlabs.com,zoomedia.com
```

### Google Cloud Console setup

Register this exact **Authorised redirect URI** on the OAuth 2.0 Client ID:

```
http://localhost:8787/api/auth/callback/google
```

and one per deployed environment, matching that environment's `BETTER_AUTH_URL`:

```
https://<api-host>/api/auth/callback/google
```

The path is fixed by better-auth's `basePath` (`/api/auth`) plus its provider callback route. The
host must be the **API** origin, not the web origin — the OAuth exchange happens server-side.

### Seeding the break-glass admin

```bash
pnpm --filter @zoo/api auth:seed-admin                      # create or repair
pnpm --filter @zoo/api auth:seed-admin -- --rotate-password # reset the password
```

Idempotent, and conservative on re-run: an existing password is left alone unless you ask for
rotation, since re-seeding is for repairing the _membership_, not silently rotating a credential.
It also repairs a downgraded role — a break-glass account that authenticates but sees nothing is
exactly the failure you cannot afford from an emergency access path.

### Admission is not authority

Passing the domain check grants a **session**. Visibility comes from `memberships` alone. A user on
the allowed domain with no membership signs in successfully and sees zero accounts — §5.2 is closed
by default. The post-login stub says so explicitly rather than looking broken.

### Two independent gates

The allowlist is enforced twice, because one check is not enough:

- **Gate 1 — user creation.** Stops an off-list Google identity ever getting a row.
- **Gate 2 — session creation.** Runs on _every_ sign-in, including returning users. Gate 1 fires
  once, ever; without gate 2 a user created before the allowlist changed, or one deactivated
  afterwards, would keep getting sessions forever. Gate 2 also enforces `users.is_active`.

Both gates are proven by test at both ends: `thestarterlabs.com` and `zoomedia.com` are admitted,
`gmail.com` is rejected — along with `outlook.com`, `notthestarterlabs.com`, `evil.zoomedia.com` and
`zoomedia.com.evil.net`. The gate-2 cases seed a user and a valid credential with **raw SQL to
bypass gate 1**, which is the only way to prove gate 2 is doing independent work, and assert that no
session row is written for a refused sign-in.

## View 2 — Feedback and Actionables (§9)

The actionables dashboard: KPI cards (open escalations, DSAT count, open action items, overdue
actions), the people/process/product error-category pie, the open-action-items table with overdue
rows flagged, the RCA tracker (agency and network scope), and the escalations list.

Every panel reads from the §8 routers or rollups, all scoped by `resolveVisibleAccounts`. The two
views share one shell (`useDashboard`, `DashboardHeader`) so the scope switch, picker, and period
controls cannot drift between them, and tabs move between View 1 and View 2 as one app.

**The error-category pie's colours were validated, not chosen.** People/process/product are the
reference palette's first three dark slots (blue/green/magenta), which pass the data-viz validator
all-pairs on this surface (worst CVD ΔE 13.0). Per §12 nothing reads by colour alone: the pie ships
with a legend _and_ a text breakdown ("People 4 (40%)…"), overdue actions carry a ⚠ icon and the word
"Overdue", and escalation severity is text (with a dot on critical), never a bare colour.

## Escalations, RCA and actions (§8)

**Escalation capabilities are split** (§5.3, by decision). `create_escalation` (manager and up)
raises one and can move it to `in_progress`; `resolve_escalation` (director and up, **not** manager)
is required to reach `resolved` or `closed`, so an escalation cannot be self-closed by whoever filed
it. Both are enforced on the same procedure by the target status.

The workflow chain: escalation → RCA (5 Whys + fishbone + people/process/product category) → action
items. Every write is capability-gated (§5.3) and scope-checked, and every mutation writes an
`audit_logs` entry (§12).

### DSAT-triggers-RCA cannot be skipped

§8 requires an RCA for every escalation and every DSAT (CSAT 1-3). This is enforced by **derivation,
not a mutable flag**: `rca.pending` returns every escalation and DSAT response in scope with no
linked RCA. Recording a DSAT — including through the real `responses.createManual` procedure the UI
calls — makes it appear immediately, and it disappears only when an RCA is linked. There is no flag
to dismiss, so the requirement is impossible to skip. An NPS detractor, however low, never triggers
it (§1 distinguishes DSAT from a detractor), and an RCA cannot be attached to a satisfied response,
so the pending list cannot be gamed.

### Status transitions are rules, not free text

Escalation and action status changes go through the transition tables in
[packages/shared/src/workflow.ts](packages/shared/src/workflow.ts). An escalation cannot jump from
`open` straight to `closed` (that would hide an unresolved problem); `closed` is terminal; both
resolved escalations and done actions can reopen because a fix sometimes does not hold.

### The one-of subject, enforced twice

An RCA points at exactly one subject — an escalation or a DSAT response, matching its `subject_type`.
The shared Zod schema rejects a mismatched or double subject before the request reaches the database,
which also has the Postgres CHECK from §4.3 as the backstop.

### Action permissions follow §5.3's three-way split

Creating needs `create_action_item`. Updating an action you **own** needs only
`update_own_action_item` (a `team_member` can). Touching someone **else's** needs
`close_others_action_item` (director and up). So the update rule depends on ownership, not a single
capability — a `team_member` can advance their own task but is refused another's, both tested.

## Metric rollups (§4.3, §6)

Dashboards read `metric_rollups`, never raw responses (§12). Six metrics per scope per period:
`csat_percent`, `average_csat`, `dsat_count`, `nps`, `response_count`, `escalation_count`.

```bash
pnpm --filter @zoo/api rollups:cron   # current + previous period, both grains, all accounts
```

**No SQL aggregates anywhere.** Every stored number comes from the metric functions in
`@zoo/shared` via `computeRollupMetrics` — a second implementation in SQL is exactly the drift §3
forbids. The recompute module does I/O and nothing else.

**Pooling is response-weighted by construction** (decision #3). An agency rollup is produced by
handing the metric functions every response from every account in that agency; there is no weighting
logic to get wrong. Proven with a fixture whose network figure (75.0) is only reachable by
response-weighting — an account-weighted mean of the same data gives 58.3.

**Recompute is idempotent.** Every value is derived from the responses currently in the window, not
by adjusting a running total, so the job is safe to run at any frequency and safe to re-run after a
failure. Verified by asserting row counts and values are unchanged across repeat runs.

**On write, the response's own period is recomputed — not today's.** Manual entry is routinely
backdated, and recomputing "now" would leave the month the response actually belongs to untouched.
The recompute is awaited before the mutation returns, so a dashboard read immediately after a write
cannot see stale numbers.

**Null survives to the database.** A period with no responses stores `value = NULL`, not 0, because
`metric_rollups.value` is nullable for exactly that reason. `dsat_count` still stores a real `0`,
with `sample_size` distinguishing "0 of 0" from "0 of 40".

Scheduling is still a stub: §16 #6 (hosting) decides whether the trigger is Vercel Cron, Workers
Cron Triggers, or a GitHub Action hitting an authenticated endpoint. All of them call
`recomputeCurrentAndPrevious`; only the trigger changes.

## View 1 — Satisfaction and Loyalty (§9)

KPI cards, CSAT and NPS trends, the promoters/passives/detractors breakdown, the 1-5 distribution,
and the account leaderboard with drill-down. All charts are Recharts; §10 keeps Three.js to three
ambient surfaces and forbids rendering metrics in 3D.

**The page never computes a metric.** It formats numbers `metrics.getScorecard` hands it, and that
procedure composes them with the same §6 functions the rollup job used to write the rows. A monthly
or quarterly request is served entirely from `metric_rollups`; only a custom range falls back to
scanning responses (§12). Every response says which path it took, and the page prints it.

**Rollups compose across periods.** `metric_rollups` also stores the CSAT 1-5 buckets and the NPS
band counts, so a six-month CSAT % is the pooled figure over all its responses rather than the mean
of six monthly percentages — which would weight a 5-response month equally with a 500-response one,
contradicting §6. The pooled window is rebuilt into an equivalent response set and passed to the
same metric functions, so there is no second, count-based implementation to drift.

**Aggregate scopes need total visibility.** An agency figure pools every account in that agency, so
seeing one of them does not grant it — `resolveScopeAccounts` refuses unless all are visible, and
the scope picker only offers what the server would accept.

### Chart colour was validated, not chosen

Promoters and detractors are **blue and red, not green and red**. The data-viz validator measured
green↔red at ΔE 4.1 under deuteranopia — the two most important bars would be indistinguishable to a
red-green colourblind reader. Blue↔red measures 19.2 (protan) and 29.0 (normal) against this app's
actual chart surface, passing every gate. The neutral grey for passives is a diverging midpoint and
sits outside the categorical gates by design, so it ships with the secondary encoding the method
requires: a legend, fixed segment order, and a 2px surface gap between segments.

Per §12, nothing depends on colour alone — the NPS band has a text label, the distribution states
its split in the subtitle, deltas carry an arrow glyph and a sign, and the leaderboard is a full
table view of the same figures.

## Scope resolution (§5.2)

`resolveVisibleAccountIds` in [packages/shared/src/rbac.ts](packages/shared/src/rbac.ts) is pure and
exhaustively unit-tested; [apps/api/src/auth/scope.ts](apps/api/src/auth/scope.ts) only loads the
rows it needs. One definition of who can see what, shared with the UI so it can hide what the server
would refuse — enforcement stays server-side and mandatory.

Scope is resolved **once per request** in the tRPC context, so a request costs three indexed reads
however many procedures it touches, and no procedure can forget to filter.

Three helpers carry the enforcement:

- `protectedProcedure` — rejects unauthenticated callers and **narrows `session` to non-null**, so
  forgetting the check is a compile error rather than a silent leak.
- `assertAccountInScope` — throws `NOT_FOUND`, never `FORBIDDEN`. `FORBIDDEN` would confirm the
  account exists to someone outside its agency.
- `intersectWithScope` — treats a client-sent account list as a _filter_, never an authorisation
  claim, so naming an out-of-scope account narrows the result instead of widening it (§12).

## Getting started

Requires Node >= 22.13 and pnpm 10.

```bash
pnpm install
cp .env.example .env     # fill in DATABASE_URL
pnpm dev                 # web on :5173, api on :8787
```

`pnpm dev` (or `npm run dev`) starts **both** apps — Turborepo fans the `dev` task out across the
workspace. Web on :5173, API on :8787.

Both entry points load the repo-root `.env` themselves via `loadRootEnv`, so no shell exports are
needed. Confirm the API is up:

```bash
curl http://localhost:8787/          # service banner + the origins it will accept
curl http://localhost:8787/health    # {"status":"ok"}
```

**Sign-in needs the API running.** If it is down, the sign-in page names the unreachable URL rather
than appearing to have a dead button.

If the API task dies at boot, Turborepo keeps the web task running, so the symptom is a working
front end that cannot authenticate. Check the API's output in the `dev` log before assuming the UI
is at fault — and note the root banner above prints `allowedOrigins`, which is the quickest way to
diagnose a CORS mismatch.

## Applying the schema

```bash
pnpm --filter @zoo/db db:migrate     # apply drizzle/*.sql to DATABASE_URL
pnpm --filter @zoo/db db:seed        # network + agency + the 16 accounts (§13)
pnpm --filter @zoo/api demo:seed     # synthetic responses for a populated dashboard
pnpm --filter @zoo/api demo:purge    # remove them, leaving real data untouched
```

**Demo data is a rich, two-agency dataset that exercises the whole app.** It adds one **demo agency**
under the real network with five demo accounts, and demo responses on both those accounts and a
subset of the real TSL accounts — so account, agency and network rollups are genuinely
distinguishable and the network pools two different agencies. It seeds ~6 months of monthly CSAT and
~2 quarters of NPS (all bands present), escalations across both agencies (every severity, channel and
status), RCAs from both DSATs and escalations (all three error categories, both methods, some DSATs
left pending an RCA), and action items with owners, ETAs and some overdue. `demo:seed` prints
per-entity and per-agency counts.

**Everything demo carries `is_demo = true`** — a dedicated column on `agencies`, `accounts`,
`surveys`, `survey_responses`, `escalations`, `rcas` and `action_items` (never a naming convention).
`demo:purge` deletes exactly those rows (FK-safe order) plus the demo accounts and demo agency, and
drops their orphaned rollups. It **cannot touch a genuine row**, and leaves the real network, the
real TSL agency, and the 16 real accounts intact with **zero associated rows** — proven by test. Both
commands **refuse to run when `NODE_ENV=production`**. `raised_by` and action owners use the
break-glass admin; no demo users are created.

Both are idempotent and safe to re-run. The seed upserts on natural keys and never overwrites
`external_form_url` / `external_sheet_id`, so hand-entered Google links survive a re-seed.

Both find the repo-root `.env` by walking up from their own directory
([load-env.ts](packages/db/src/load-env.ts)) rather than by a hand-counted relative path. A counted
path is silently wrong the moment a file changes directory depth, and dotenv does not warn when the
path it is handed does not exist — the failure then surfaces as a confusing "DATABASE_URL is not set"
from a file that visibly loads `.env`. A shell-supplied variable always wins over the file.

Migrations are generated with `pnpm --filter @zoo/db db:generate` and are the only path to DDL (§12).
`drizzle/0001_updated_at_triggers.sql` is hand-written — it installs the `updated_at` trigger backstop
§4.1 asks for, covering writes that bypass the ORM.

## Commands

Run from the repo root; Turborepo fans them out across the workspace.

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | web + api in watch mode              |
| `pnpm typecheck` | `tsc --noEmit` in every package      |
| `pnpm test`      | Vitest across the workspace          |
| `pnpm lint`      | ESLint                               |
| `pnpm format`    | Prettier write (SPEC.md is excluded) |
| `pnpm build`     | production build                     |

## Layout

```
apps/
  web/       Vite React SPA — dashboard + native survey UI
  api/       Hono + tRPC server, cron handlers, AI service
packages/
  db/        Drizzle schema, migrations, seed, query helpers
  shared/    Zod schemas, shared types, metric formulas, enums
```

`packages/shared` holds exactly one definition of each metric (SPEC.md §3). Both the rollup job and
any live-compute path import from it, so CSAT %, NPS, and DSAT cannot drift between them.

## Architectural decisions made during Milestone 1

**API is host-portable.** `createApp(env)` in [apps/api/src/app.ts](apps/api/src/app.ts) is a factory
over validated env with no import-time side effects. [server.ts](apps/api/src/server.ts) is the only
Node-specific file. Section 16 #6 (hosting) is still open, so moving to Vercel or Workers means
adding an entry file, not rewriting the app.

**Env loading takes its source as an argument.** `parseServerEnv(source)` never reads `process.env`
itself, which is what lets the same validation work under Node (`process.env`) and Workers
(bindings). It throws on the first invalid config rather than starting a half-configured process —
verified by test and by boot.

**`ApiContext` is a type alias, not an interface.** `@hono/trpc-server` requires the context to be
assignable to `Record<string, unknown>`, and only type aliases get an implicit index signature.

**superjson from the start.** Configured on both sides now so Date/Map/Set survive the wire. Adding a
transformer after real payloads exist would silently change every response shape.

**Type-only router import.** `apps/web` imports `AppRouter` as a type only. Verified: the production
bundle contains zero references to `@hono/trpc-server`, `drizzle`, `neondatabase`, or `initTRPC`.

## Version pinning

Every dependency was resolved against the npm registry at scaffold time, not from memory, per the
note at the top of SPEC.md. Exact versions are pinned (no `^`) so CI and local agree.

**TypeScript is pinned to 6.0.3, not the latest 7.0.2.** TypeScript 7 is the native-port rewrite and
is genuinely stable, but `typescript-eslint@8.64.0` declares `typescript >=4.8.4 <6.1.0` — adopting
TS 7 today means giving up the entire type-aware lint layer, which SPEC.md §2 requires. Revisit once
typescript-eslint ships TS 7 support; the upgrade should be a version bump.

## Decisions made during Milestone 2

**Metrics return `null` for an empty set, never 0.** "No responses this period" and "0% satisfied"
are different facts. This propagates: `metric_rollups.value` is nullable for the same reason, so a
quiet month reaches the KPI card as "no data" rather than a false zero.

**Response-weighted pooling is structural, not a flag** (§6, confirmed decision #3). Every metric
function takes a flat response set, so pooling a scope means passing all underlying responses — a
500-response account moves the agency number more than a 5-response one. There is deliberately no
account-weighted variant; §6 leaves that as a later toggle and a second implementation now would be
a second definition to keep in sync. Tested explicitly in `metrics.test.ts`.

**Score bounds are enforced by a type-aware CHECK.** `survey_responses` rejects a CSAT score outside
1-5 and an NPS score outside 0-10, in one constraint that switches on `type`. §4.3 states the ranges;
this makes them unbypassable by a drifted Google column mapping.

**`survey_responses.score` is NOT NULL.** §7.1 lists "missing score" as a sync failure mode, so such
rows are counted into `sync_runs.rows_skipped` rather than stored as scoreless responses that would
distort every average.

**UUID v7 generated in application code**, not by a Postgres default: `uuidv7()` is only built in
from Postgres 18 and this must work on whatever version a Neon branch runs.

**Schema and seed are integration-tested against real Postgres.** `schema.test.ts` runs the actual
migrations against PGlite (in-process Postgres, no Neon connection needed, so it runs in CI) and
asserts the constraints reject bad data, rather than asserting the DDL merely contains them.
`seed-core.test.ts` runs the real seed three times over to prove idempotency: no duplicate rows, no
churned ids, and no clobbering of a link corrected by hand.

**Seed logic is separated from the CLI.** `seed-core.ts` exports `seedOrg(db)` taking any
Postgres-dialect Drizzle client; `seed.ts` only loads env, connects and reports. That is what lets
the same code path run against Neon in production and PGlite in tests.

### Additions beyond §4.3

Both are integrity constraints the spec implies but does not spell out. Flagged so they are a
reviewed decision, not a silent extra:

- `UNIQUE(network_id, slug)` on agencies and `UNIQUE(agency_id, slug)` on accounts — slugs address
  these in URLs. Scoped rather than global so sibling networks can reuse a slug later (§16 #8).
- `created_at` on `metric_rollups`. §4.3's column list omits it, but §4.1 says every table has one.

### Columns §4 leaves untyped, tightened to enums

§4.3 names these five columns but §4.2 declares no matching enum, so they began as `text`. Tightened
to Postgres enums by decision while the schema was still empty, so no data migration was needed:

| Column                     | Enum                 | Members                           |
| -------------------------- | -------------------- | --------------------------------- |
| `accounts.status`          | `account_status`     | prospect, active, paused, churned |
| `rcas.status`              | `rca_status`         | open, in_progress, closed         |
| `action_items.source_type` | `action_source_type` | rca, escalation, standalone       |
| `action_items.priority`    | `action_priority`    | low, medium, high, urgent         |
| `sync_runs.status`         | `sync_status`        | running, success, partial, failed |

Two nullability calls came with them. `source_type` is NOT NULL defaulting to `standalone`, because
the enum has an explicit member for "neither an RCA nor an escalation" — keeping the column nullable
too would make null and `standalone` two spellings of one state. `priority` stays nullable, because
there is no equivalent "unset" member and defaulting to `medium` would invent a triage decision
nobody made. `sync_runs.status` has no default, so a crashed job is never indistinguishable from one
that never started.

## Google Form references (§13)

All 16 accounts carry their `external_form_url`. `external_form_id` is **derived from the URL** by
`parseFormId` rather than listed, so an id can never disagree with the link it came from.

The parser is deliberately narrow — it matches only `/forms/d/{id}/edit`, the authoring URL, where
the path segment genuinely is the form id. It returns null for the other two shapes:

- `/forms/d/e/{id}/viewform` — that id is a _response_ identifier, not the form id. It cannot be used
  against the Forms API, so storing it would produce a column that looks populated and fails at
  Milestone 8.
- `forms.gle/{slug}` — resolves to a form only by following a redirect, which seeding does not do.

So exactly **3 of 16** accounts (Mogu Mogu, Chemistry, Inkspired) have a resolved `external_form_id`.
**EPCH** is Sheet-backed per §13: `external_sheet_id` set, both form columns null. The remaining
**12 need their form ids resolved during sync setup**, and `db:seed` names them on every run.

## Open questions

**NPS band boundary at 50.** §6 puts 50 in both "30-50 good" and "50-70 excellent". Resolved to
half-open bands `[min, max)`, so 50 is excellent and 70 is gold standard. The 0-30 range §6 leaves
unnamed is labelled `needs_improvement`. Both confirmed.

**RCA subject FKs are `SET NULL` while the CHECK requires one to be set.** Both are mandated by §4.3.
The consequence: hard-deleting an escalation that has an RCA fails the CHECK instead of silently
orphaning the analysis. That is the safer outcome, and soft delete is the normal path — noted in case
you want it to behave differently.

## Open decisions from §16

Running on the spec's stated defaults unless overridden:

- ~~**#3 aggregation**~~ — confirmed response-weighted, implemented.
- ~~**#7 RLS**~~ — confirmed app-layer only for v1, deferred to Milestone 12.
- **#4 auth mechanism** (better-auth, email/password + optional Google SSO) — needed for Milestone 3.
- **#6 hosting** — deferred by the portable API design above; needed by Milestone 12 for cron.
