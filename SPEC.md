# Zoo Media CX Platform — Build Spec (PRD) + Claude Code Kickoff Prompt

This is the authoritative product and architecture spec. Commit it to the repo root as `SPEC.md`. Claude Code / Cursor reads this, then executes in the milestone order in Section 14. The paste-ready kickoff prompt is Section 15.

Version pinning note: every library named below is a recommendation with rationale, not a version assertion. Pin the current stable version of each at build time (`pnpm add <pkg>@latest`, then lock). Do not trust any version numbers from model memory. Verify tRPC, TanStack Router, better-auth, and Drizzle release status before locking, since these move fast.

---

## 1. What the system is

An internal Customer Experience (CX) analytics and workflow platform for the Zoo Media agency network. It measures client satisfaction and loyalty, captures escalations, drives root cause analysis, and tracks corrective action to closure.

Three-tier hierarchy, top to bottom:

1. Network (Zoo Media) — cumulative view across all agencies.
2. Agency (The Starter Labs / TSL, and sibling agencies) — view across that agency's accounts.
3. Account / Brand (Mogu Mogu, Chemistry, SOA, etc.) — the individual client.

Two headline metrics:

- CSAT (Customer Satisfaction) — 1 to 5 scale, monthly, transactional. Answered by the daily service recipient. Scores 4 and 5 are satisfied. Scores 1, 2, 3 are DSAT (dissatisfied).
- NPS (Net Promoter Score) — 0 to 10 scale, quarterly, relationship. Answered by the client-side decision maker. 0 to 6 detractors, 7 to 8 passives, 9 to 10 promoters.

Two workflow objects downstream of feedback:

- Escalation — critical feedback from any channel (form, email, call, meeting).
- RCA (Root Cause Analysis) — mandatory for every escalation and every DSAT (CSAT score 1, 2, 3). Produces an error category (people / process / product) and a set of corrective action items with owner and ETA.

The service loop the product operationalises: Service Layer → Delivery → Client Feedback (CSAT/NPS) → Action Items → Learnings → Actions Implemented → back to floor.

Current data source: 16 Google Forms, one per account, feeding Google Sheets response tabs. The platform replaces or ingests these (Section 7).

---

## 2. Locked stack

Frontend

- React + Vite + TypeScript (strict). Client preference, locked.
- shadcn/ui + Tailwind for components and design tokens.
- TanStack Router (type-safe routing) and TanStack Query (server state).
- react-hook-form + Zod for forms and validation.
- Recharts (shadcn charts wrapper) for all data charts. Do not use Three.js for data charts.
- @react-three/fiber + @react-three/drei for the three ambient 3D surfaces defined in Section 10, lazy-loaded.
- framer-motion for shadcn-style micro-interactions and list/route transitions.

Backend

- Node service using Hono (TS-first, edge-capable, thin). Alternative: Fastify if a traditional Node host is chosen. Pick one, do not mix.
- tRPC v11 for the API contract so client and server share types end to end. This is the reason the app is a monorepo. If a public REST surface is later needed, expose it via a thin adapter, do not replace tRPC.
- Drizzle ORM against Neon Postgres, using the Neon serverless driver.
- Zod as the single validation layer, shared between tRPC input schemas and forms.
- better-auth for authentication and session management, with a custom RBAC layer on top (Section 5). Alternatives: Lucia (more manual), Auth.js. Confirm choice in Section 16.

Data and infra

- Neon Postgres (single logical DB, schema-per-environment or branch-per-environment via Neon branching).
- Scheduled jobs (Google sync, metric rollups) run on a cron. Target-dependent: Vercel Cron, Cloudflare Workers Cron Triggers, or a GitHub Actions schedule hitting an authenticated endpoint. Decide with hosting (Section 16).

AI

- Server-side only. OpenRouter or Anthropic direct. Keys never reach the client. Use cases and guardrails in Section 11.

Tooling

- pnpm workspaces + Turborepo. TypeScript strict everywhere. ESLint + Prettier. Vitest for unit, Playwright for E2E. Drizzle Kit for migrations. Env validation with Zod at boot (fail fast on missing vars).

---

## 3. Monorepo layout

```
repo/
  apps/
    web/                 # Vite React SPA (dashboard + native survey UI)
    api/                 # Hono + tRPC server, cron handlers, AI service
  packages/
    db/                  # Drizzle schema, migrations, seed, query helpers
    shared/              # Zod schemas, shared types, metric formulas, enums
    ui/                  # optional: shared shadcn component layer
  turbo.json
  pnpm-workspace.yaml
```

Metric formulas (CSAT %, NPS, DSAT count) live in `packages/shared` as pure functions, imported by both the rollup job and any live-compute path, so there is exactly one definition of each metric.

---

## 4. Data model and DB schema

### 4.1 Conventions (industry standard, enforce everywhere)

- Primary keys: UUID v7 (time-ordered) or cuid2. Do not use bare serial ints for public-facing rows. Store as `uuid`/`text`.
- Every table has `created_at timestamptz NOT NULL DEFAULT now()` and, where rows mutate, `updated_at timestamptz NOT NULL DEFAULT now()` maintained via Drizzle `$onUpdate` plus a DB trigger as backstop.
- Soft delete via `deleted_at timestamptz NULL` only on tables that require retention (accounts, escalations, rcas, action_items, survey_responses). Hard delete lookups.
- Foreign keys explicit, with deliberate `ON DELETE`: `RESTRICT` for reference integrity (cannot delete an account with responses), `CASCADE` only for owned child rows (rca_whys under an rca).
- Enums as Postgres enums via Drizzle `pgEnum`. List them in `packages/shared` so the app and DB agree.
- Index every FK column and every column used in dashboard filters (`account_id`, `submitted_at`, `status`, `type`, scope columns).
- All money/score values typed exactly. Scores are `smallint`. No floats for scores.
- `external_response_id` is `UNIQUE (source, external_response_id)` for idempotent imports (re-running a Google sync must not duplicate rows).
- Audit everything mutating via `audit_logs`.

### 4.2 Enums

```
role_key:          super_admin | network_admin | agency_admin | account_director | account_manager | team_member | viewer
scope_type:        network | agency | account
metric_type:       csat | nps
survey_source:     google_form | native | import
question_kind:     scale | text | single_choice | multi_choice
escalation_source: form | email | call | meeting | other
escalation_status: open | in_progress | resolved | closed
severity:          low | medium | high | critical
rca_subject:       escalation | dsat_response
rca_method:        five_whys | fishbone | scatter
error_category:    people | process | product
action_status:     open | in_progress | blocked | done
period_grain:      monthly | quarterly | custom
ai_kind:           sentiment | theme | category_suggestion | summary
```

### 4.3 Tables

Structure and org

- `networks(id, name, slug UNIQUE, created_at, updated_at)`
- `agencies(id, network_id FK->networks RESTRICT, name, slug, created_at, updated_at)`; index `(network_id)`
- `accounts(id, agency_id FK->agencies RESTRICT, name, slug, industry, brand_owner, status, external_form_url, external_sheet_id, external_form_id, csat_cadence period_grain DEFAULT monthly, nps_cadence period_grain DEFAULT quarterly, created_at, updated_at, deleted_at)`; index `(agency_id)`, `(status)`

Identity and RBAC

- `users(id, email UNIQUE, name, avatar_url, is_active bool DEFAULT true, last_login_at, created_at, updated_at)` (auth credential tables owned by better-auth)
- `memberships(id, user_id FK->users CASCADE, scope_type scope_type, scope_id uuid, role role_key, created_at, updated_at, UNIQUE(user_id, scope_type, scope_id))`; index `(user_id)`, `(scope_type, scope_id)`. This one table drives all visibility. A user with a `network` membership sees everything; an `agency` membership sees that agency and its accounts; an `account` membership sees those accounts. `scope_id` is a soft FK (validated in app) because it points to one of three tables.

Surveys and responses

- `surveys(id, account_id FK->accounts RESTRICT, type metric_type, title, source survey_source, source_form_id, cadence period_grain, is_active bool, created_at, updated_at)`; index `(account_id, type)`
- `survey_questions(id, survey_id FK->surveys CASCADE, prompt, kind question_kind, position int, is_required bool, created_at)`; index `(survey_id)` (native surveys only)
- `survey_responses(id, survey_id FK->surveys RESTRICT, account_id FK->accounts RESTRICT, type metric_type, score smallint, respondent_name, respondent_email, source survey_source, external_response_id, period_start date, period_end date, submitted_at timestamptz, created_at, deleted_at, UNIQUE(source, external_response_id))`; index `(account_id, submitted_at)`, `(type, submitted_at)`, `(survey_id)`. `score` is the headline value (1-5 for csat, 0-10 for nps). DSAT is derived, not stored: `type=csat AND score<=3`.
- `response_answers(id, response_id FK->survey_responses CASCADE, question_id FK->survey_questions SET NULL, question_label, answer_text, answer_value smallint, created_at)`; index `(response_id)`. Holds open-text and secondary answers.

Escalations, RCA, actions

- `escalations(id, account_id FK->accounts RESTRICT, raised_by_user_id FK->users SET NULL, source escalation_source, severity severity, title, description, status escalation_status DEFAULT open, reported_at, resolved_at, created_at, updated_at, deleted_at)`; index `(account_id, status, reported_at)`
- `rcas(id, account_id FK->accounts RESTRICT, subject_type rca_subject, escalation_id FK->escalations SET NULL, response_id FK->survey_responses SET NULL, method rca_method, error_category error_category, problem_statement, findings jsonb, status, created_by_user_id FK->users SET NULL, created_at, updated_at, deleted_at)`; index `(account_id, created_at)`, `(error_category)`. Exactly one of `escalation_id` / `response_id` is set, matching `subject_type` (enforce with a CHECK constraint).
- `rca_whys(id, rca_id FK->rcas CASCADE, level smallint, question, answer, created_at)` for the 5 Whys chain; index `(rca_id, level)`
- `rca_causes(id, rca_id FK->rcas CASCADE, bucket, cause, created_at)` for fishbone branches; index `(rca_id)`
- `action_items(id, account_id FK->accounts RESTRICT, source_type text, rca_id FK->rcas SET NULL, escalation_id FK->escalations SET NULL, title, description, owner_user_id FK->users SET NULL, eta date, priority, status action_status DEFAULT open, closed_at, created_at, updated_at, deleted_at)`; index `(owner_user_id, status)`, `(account_id, status, eta)`

Aggregation and ops

- `metric_rollups(id, scope_type scope_type, scope_id uuid, metric text, period_grain period_grain, period_start date, period_end date, value numeric, sample_size int, computed_at, UNIQUE(scope_type, scope_id, metric, period_grain, period_start))`; index `(scope_type, scope_id, metric, period_start)`. Precomputed CSAT %, NPS, DSAT count, escalation count, response count per scope per period. Dashboards read this, not raw responses. A cron recomputes the current and previous period on a schedule and on write.
- `sync_runs(id, source, account_id FK->accounts SET NULL, started_at, finished_at, status, rows_seen, rows_imported, rows_skipped, error, created_at)`; index `(account_id, started_at)`
- `ai_analyses(id, entity_type, entity_id, kind ai_kind, model, input_hash, output jsonb, created_at, UNIQUE(entity_type, entity_id, kind, input_hash))`; caches AI output so identical input is never re-billed.
- `audit_logs(id, actor_user_id FK->users SET NULL, action, entity_type, entity_id, diff jsonb, ip, created_at)`; index `(entity_type, entity_id)`, `(actor_user_id, created_at)`

---

## 5. RBAC model

### 5.1 Roles (highest to lowest)

- super_admin: platform owner. All data, all writes, user and account management, sync control.
- network_admin: Zoo Media leadership. All agencies and accounts, read plus escalation/RCA/action oversight, no platform config.
- agency_admin: TSL leadership. Their agency and all its accounts. Full workflow writes within scope.
- account_director: assigned accounts. Full workflow writes on those accounts.
- account_manager: assigned accounts. Create escalations, author RCA, own and update action items.
- team_member: assigned accounts. Read metrics, update own action items.
- viewer: read-only within granted scope.

### 5.2 Scope resolution (the core of RBAC)

On each request, resolve the caller's visible `account_id` set from `memberships`:

- any `network` membership → all accounts in that network.
- `agency` membership → all accounts under that agency.
- `account` membership → those account ids.

A single reusable function `resolveVisibleAccounts(userId)` returns the id set. Every list and aggregate query filters by it. Every single-entity fetch checks membership before returning. Put this in tRPC middleware so no procedure can forget it.

### 5.3 Permission matrix (verb x role)

| Capability                 | super | net_admin | agency_admin | director | manager | member | viewer |
| -------------------------- | ----- | --------- | ------------ | -------- | ------- | ------ | ------ |
| View metrics (in scope)    | Y     | Y         | Y            | Y        | Y       | Y      | Y      |
| Network-level view         | Y     | Y         | N            | N        | N       | N      | N      |
| Enter response (manual)    | Y     | Y         | Y            | Y        | Y       | N      | N      |
| Create escalation          | Y     | Y         | Y            | Y        | Y       | N      | N      |
| Resolve / close escalation | Y     | Y         | Y            | Y        | N       | N      | N      |
| Author / edit RCA          | Y     | Y         | Y            | Y        | Y       | N      | N      |
| Create action item         | Y     | Y         | Y            | Y        | Y       | N      | N      |
| Update own action item     | Y     | Y         | Y            | Y        | Y       | Y      | N      |
| Close others' action item  | Y     | Y         | Y            | Y        | N       | N      | N      |
| Manage accounts            | Y     | Y         | Y            | N        | N       | N      | N      |
| Manage users / memberships | Y     | Y         | scope only   | N        | N       | N      | N      |
| Trigger sync               | Y     | Y         | Y            | N        | N       | N      | N      |
| Platform config            | Y     | N         | N            | N        | N       | N      | N      |

Enforce in two layers: app-layer scope filter (mandatory) plus optional Postgres RLS as defence in depth. Confirm RLS scope in Section 16.

---

## 6. Metric definitions (single source of truth, in `packages/shared`)

Compute all of these as pure functions over a response set.

- CSAT % = ( count of csat responses with score in {4,5} / total csat responses ) x 100. Report to one decimal. Also expose average CSAT (mean of 1-5) as a secondary figure.
- DSAT count = count of csat responses with score in {1,2,3}. DSAT rate = DSAT count / total csat responses.
- NPS = %promoters − %detractors, where promoters have score in {9,10}, detractors in {0..6}, passives {7,8} counted in the base but not the numerator. Range −100 to +100.
- NPS bands for labelling: <0 worrisome, 30–50 good, 50–70 excellent, 70+ gold standard (per the deck).
- Error category distribution = share of RCAs by `error_category` over the period (drives the people/process/product pie).
- Escalation count, open action count, overdue action count (`status != done AND eta < today`) per scope.

Aggregation rule (confirm in Section 16): network and agency CSAT/NPS are pooled over all underlying responses (response-weighted), not a mean of per-account scores. Expose an account-weighted alternative behind a toggle if requested.

Time grains: monthly (CSAT), quarterly (NPS), plus custom range. A period selector drives every view.

---

## 7. Data ingestion

Two supported paths. Build native surveys as the strategic path; keep Google sync for continuity and back-data.

### 7.1 Google Forms/Sheets sync (continuity)

Each account row carries `external_sheet_id` and `external_form_id`. A cron job per account:

1. Reads new rows from the linked responses sheet via the Google Sheets API (service account with read access shared to each sheet).
2. Maps columns to the normalised schema. The 16 forms are not guaranteed identical, so store a per-account column-mapping config (which column is the score, which is the period, which are open-text). Keep this mapping in a config table or JSON per account, not hard-coded.
3. Upserts into `survey_responses` keyed by `(source='google_form', external_response_id)` for idempotency. Records the run in `sync_runs`.

Failure modes to handle explicitly: schema drift (a form changed columns), missing score, duplicate submissions, timezone on `submitted_at`. Sync must be safe to re-run.

### 7.2 Native surveys (strategic)

Tokenised, branded survey links per account and period. `surveys` + `survey_questions` define the instrument; submissions write directly to `survey_responses` with `source='native'`. This removes Sheets dependency, gives clean question schemas, and lets NPS and CSAT respondent lists differ per account (daily contact vs decision maker).

Recommendation: ship native surveys in v1, run both in parallel during migration, deprecate Google Forms per account once native is live.

---

## 8. API surface (tRPC routers)

Group procedures by domain. Every procedure runs through auth + scope middleware.

- `auth`: session, me, logout.
- `org`: networks/agencies/accounts CRUD (guarded by manage-accounts), account list scoped to caller.
- `users`: user + membership management (guarded).
- `metrics`: `getScorecard({scope, scopeId, grain, from, to})` → CSAT %, NPS, DSAT, counts + trend series; `getTrend(...)`; `getAccountLeaderboard(agencyId, period)`; `getErrorCategoryBreakdown(...)`. Reads `metric_rollups` first, falls back to live compute for custom ranges.
- `responses`: list/detail (scoped), manual entry, native submit (public tokenised endpoint, rate-limited).
- `escalations`: CRUD, status transitions, auto-flag DSAT responses that need an RCA.
- `rca`: create from escalation or DSAT response, whys, causes, set error_category, link action items.
- `actions`: CRUD, assign, status, overdue query.
- `sync`: trigger per account, run history.
- `ai`: analyseFeedback, suggestErrorCategory, draftRca, generateSummary (Section 11).

DSAT-to-RCA rule enforced server-side: when a csat response lands with score in {1,2,3}, create a pending RCA task (or a flag surfaced in the actionables view) so the requirement in the deck ("RCA required for all escalations and CSAT 1,2,3") cannot be skipped.

---

## 9. Dashboard views

Global controls on both views: scope switch (Network / Agency / Account), account or agency picker (options limited by RBAC scope), period grain (Monthly / Quarterly / Custom), date range.

### View 1 — Customer Satisfaction and Loyalty

- KPI cards: CSAT % (with period-over-period delta and trend sparkline), NPS (with band label and delta), response count, DSAT rate.
- CSAT trend line over the selected grain.
- NPS trend line plus a stacked promoters/passives/detractors bar.
- CSAT distribution histogram (counts by 1-5).
- At agency/network scope: account leaderboard table (account, CSAT %, NPS, responses, trend) sortable, with drill-down to the account view.

### View 2 — Customer Feedback and Actionables

- KPI cards: open escalations, DSAT count, open action items, overdue actions.
- Error category pie (people / process / product) from RCA distribution.
- Open action items table: item, account, owner, ETA, status, with overdue rows visually flagged.
- RCA tracker table at network and agency level: subject, account, method, error category, status, linked actions.
- Escalations list with severity and status.

Service loop can render as an animated SVG or lightweight canvas element (not full Three.js) on an overview/landing panel.

---

## 10. Three.js placement (deliberate, not decorative on data)

Three surfaces only. Everything else is 2D. All 3D is lazy-loaded, respects `prefers-reduced-motion` (falls back to a static image or 2D), and never blocks first paint.

1. Auth / landing hero: an ambient particle or shader field in brand colours. Pure atmosphere, low cost, paused when tab hidden.
2. Org constellation (overview page): a 3D force-directed node graph of Network → Agencies → Accounts. Node colour encodes CSAT health, node size encodes response volume. Click a node to drill into that scope. This is the one place 3D earns its keep, because it shows hierarchy and health at once.
3. Empty and loading states: subtle 3D motion instead of blank spinners.

Do not render CSAT/NPS trends, distributions, or tables in Three.js. Data charts stay in Recharts for legibility and accessibility. Use framer-motion for card, list, and route transitions (the shadcn-style motion layer).

Technique rules: single `<Canvas>` per surface, `@react-three/drei` helpers, `useFrame` throttled, geometry/material memoised, dispose on unmount, cap DPR, gate behind `IntersectionObserver` so off-screen canvases stop rendering.

---

## 11. AI layer (server-side only)

Provider: OpenRouter or Anthropic direct, key in server env only. Every call returns structured JSON (schema-validated with Zod) and is cached in `ai_analyses` by `input_hash` so identical input is free on repeat.

Use cases:

1. Open-text feedback analysis: sentiment and theme extraction on response open-text and escalation descriptions.
2. Error category suggestion: propose people / process / product for an RCA from its problem statement and evidence. Human confirms; AI never sets the final category unaided.
3. RCA assist: draft a 5 Whys chain and candidate fishbone causes for the author to edit.
4. Executive summary: generate the monthly/quarterly CX narrative per account/agency from the rollups and open items.

Guardrails: AI output is always advisory and editable, never written straight to a system-of-record field without human confirmation. No fabricated metrics in summaries (feed it only computed rollup numbers, instruct it to use only those). Rate-limit and budget-cap the endpoints. Log model and prompt version.

---

## 12. Non-functional requirements

- Security: server-side authz on every procedure, no trust in client-sent scope. Tokenised public survey endpoints are rate-limited and single-purpose. Secrets in env, validated at boot.
- Auditability: `audit_logs` on every create/update/delete of escalations, RCAs, actions, accounts, memberships.
- Timestamps: `created_at`/`updated_at` on all mutable tables, timezone-aware, UTC in DB, localised in UI.
- Data integrity: FKs and CHECK constraints as specified; idempotent sync; migrations via Drizzle Kit, never manual DDL in prod.
- Testing: Vitest unit tests for the metric functions and scope resolver (these are the highest-risk logic). Playwright E2E for the two dashboard views and the escalation-to-RCA-to-action flow.
- Performance: dashboards read `metric_rollups`; raw scans only for custom ranges. Index per Section 4.
- Accessibility: charts have table fallbacks, 3D degrades under reduced-motion, colour is never the only signal (pair with labels/icons).

---

## 13. Seed data (the 16 accounts)

Seed one network (Zoo Media), one agency (The Starter Labs), and these accounts with their external form references. Store the form URLs on `accounts.external_form_url`; extract the form id into `external_form_id`.

Mogu Mogu, Chemistry, Inkspired, SOA, The Croffle Guys, Anemos, Standard Chartered, WhiteOak, Alka Seltzer, BuildWell, Spunge, EPCH, AJ, Ryan, HyKr Venture Studio, Sunteck.

(EPCH's link is a Sheet, not a Form. Treat it as `external_sheet_id` directly. The rest are Forms whose response sheets must be located during sync setup.)

---

## 14. Build order (milestones)

1. Repo scaffold: monorepo, Vite web app, Hono+tRPC api, Drizzle+Neon, env validation, CI. Prove client↔server type flow with one procedure.
2. DB schema + migrations + enums + seed (Section 4, 13). Metric functions in `shared` with unit tests.
3. Auth (better-auth) + memberships + scope resolver + tRPC auth/scope middleware. Test RBAC with fixtures.
4. Manual response entry + `survey_responses` + rollup job. Get real numbers flowing without Google yet.
5. View 1 (Satisfaction and Loyalty) end to end against rollups.
6. Escalations → RCA (5 Whys, fishbone, error category) → action items. Enforce DSAT-triggers-RCA rule.
7. View 2 (Feedback and Actionables) including error-category pie, action table, RCA tracker.
8. Google Sheets sync with per-account column mapping, `sync_runs`, idempotency. Backfill history.
9. Native survey builder + tokenised submission. Run parallel to Google.
10. Three.js org constellation + hero + motion polish (Section 10).
11. AI layer (Section 11), advisory only, cached.
12. Hardening: audit logs, RLS if chosen, E2E suite, deploy + cron.

Ship 1-7 as the usable core. 8-12 layer on without rework because the schema already anticipates them.

---

## 15. Claude Code kickoff prompt (paste this)

```
You are building the Zoo Media CX Platform. SPEC.md in the repo root is authoritative; read it fully before writing code, and treat its Sections 4, 5, and 6 (DB schema, RBAC, metric formulas) as non-negotiable contracts.

Stack (pin current stable versions, do not trust memorised version numbers): pnpm + Turborepo monorepo; apps/web = React + Vite + TypeScript strict + shadcn/ui + Tailwind + TanStack Router + TanStack Query + react-hook-form + Zod + Recharts + @react-three/fiber/drei + framer-motion; apps/api = Hono + tRPC v11 + Drizzle ORM + Neon serverless driver + better-auth; packages/db and packages/shared for schema and shared Zod/metric logic.

Rules:
- One definition of each metric, in packages/shared, imported by both the rollup job and any live compute. Unit-test CSAT %, NPS, DSAT, and the scope resolver first.
- Every tRPC procedure passes through auth + scope middleware. No procedure trusts client-sent scope. resolveVisibleAccounts(userId) gates all reads.
- Migrations only through Drizzle Kit. Enforce the CHECK constraints and unique keys in the spec (idempotent sync, one-of subject FK on rcas).
- Three.js is limited to the three surfaces in Section 10, lazy-loaded, reduced-motion aware. All data charts are Recharts. Do not render metrics in 3D.
- AI (Section 11) is server-side, structured-output, cached, and advisory only. Never write AI output to a system-of-record field without human confirmation. Never let AI invent numbers; feed it only computed rollups.

Work milestone by milestone in Section 14. Do not skip ahead. After each milestone: run typecheck, run tests, and stop for review before starting the next. If any decision in Section 16 is still unresolved and blocks the current milestone, ask before assuming.

Start with Milestone 1: scaffold the monorepo, wire one end-to-end tRPC procedure to prove the type flow, and set up Zod-validated env loading. Then stop.
```

---

## 16. Open decisions (confirm or override; defaults chosen so the build can start)

Each has a working default so nothing blocks. Override only where you disagree.

1. Data source for v1. Default: build native surveys AND keep Google sync, run parallel. Override if you want Google-only (faster) or native-only (cleaner, but loses continuity).
2. Are the 16 Google Forms question-identical or inconsistent? This decides whether column mapping is one shared config or per-account. Default assumes per-account mapping (safe). Need read access (service account) to the response sheets, or CSV exports.
3. Network/agency aggregation. Default: response-weighted pooling. Override to account-weighted mean if leadership wants every account to count equally regardless of response volume.
4. Auth mechanism. Default: better-auth with email/password + optional Google Workspace SSO. Confirm whether Zoo Media is on Google Workspace and wants SSO enforced.
5. External (client-facing) login. Default: internal-only; clients only submit surveys, no client dashboard login. Override if clients get read access to their own account view.
6. Hosting target. Default assumption: Vercel (web) + a Node host or Vercel functions (api) + Neon, cron via Vercel Cron. Override for Cloudflare (Hono on Workers, Workers Cron) or self-host. This decides the api runtime and cron mechanism.
7. RLS. Default: app-layer scope enforcement only for v1, add Postgres RLS in Milestone 12. Override to require RLS from the start.
8. Multi-tenancy. Default: single network (Zoo Media) modelled as a row, so multi-network is possible later but not built now. Override if sibling networks are in scope on day one.
9. Historical backfill. Default: import all existing Google Form history during Milestone 8. Confirm how far back and whether older forms are still accessible.
10. AI scope for v1. Default: AI is Milestone 11 (post-core). Override to pull feedback sentiment / RCA assist earlier if that is the priority.
11. NPS vs CSAT respondents. Default: native surveys support separate respondent lists per account (decision maker for NPS, daily contact for CSAT). Confirm you want contact management in-app or handled externally.
