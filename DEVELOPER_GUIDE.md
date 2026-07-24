# Zoo Media CX — Developer Guide

Architecture and ops notes for extending and deploying the CX platform.

## Stack

| Layer | Package / app | Notes |
|-------|---------------|--------|
| Web | `apps/web` | React + Vite + TanStack Router + tRPC client. Single Vercel project (Root Directory `apps/web`). |
| API | `apps/api` | Hono + tRPC. Bundled into the web serverless handler on Vercel (`server/handler.ts` → `handler.bundle.mjs`). |
| DB | `packages/db` | Drizzle + Neon Postgres. |
| Shared | `packages/shared` | Enums, metrics math, RBAC matrix, Zod inputs. No Node/DOM. |

Authoritative product spec: [SPEC.md](SPEC.md). Deploy: [DEPLOY.md](DEPLOY.md).

## Environment

Required server env (see `apps/api/src/env.ts`): `DATABASE_URL`, Better Auth secrets, Google OAuth client, `WEB_ORIGIN` / `BETTER_AUTH_URL`, domain allowlist, optional `SUPERADMIN_EMAIL`.

Web: `VITE_API_URL` must be empty or same-origin in production so `/api` hits the Vercel rewrite — never bake `http://localhost:8787` into a production build.

## Org model & Global scope

- **Network** Zoo Media → agencies **The Starter Labs** + **Foxy** (+ demo agency when seeded).
- Memberships use DB `scope_type`: `network` | `agency` | `account` only.
- Dashboard **Global** is a **virtual** view scope (`VIEW_SCOPE_TYPES` / `GLOBAL_SCOPE_ID` in `@zoo/shared`). It pools `visibleAccountIds` — never trust client-sent scope; `resolveScopeAccounts` always intersects memberships (`apps/api/src/auth/scope.ts`).

Adding another agency: follow the Foxy pattern in `packages/db/src/seed-data.ts` (`SEED_AGENCY_*` + accounts) and optionally add demo profiles in `apps/api/src/demo/demo-data.ts`.

## Metrics / rollups

- Headline CSAT % = share of CSAT responses with score ∈ {4,5} (Q1 only).
- DSAT = CSAT score ≤ 3.
- NPS is a separate instrument (0–10 bands).
- Stored rollups live on `metric_rollups` by scope. **Global** has no stored row — scorecards pool account-tier rollups (`poolAccountRollupsByPeriod`).
- `metrics.getAgencyBreakdown` supports network/global agency comparison.

## Tabs & routers

| UI route | Purpose | Key APIs |
|----------|---------|----------|
| `/` | CX metrics | `metrics.getScorecard`, `getAccountLeaderboard`, `getAgencyBreakdown` |
| `/dsat` | DSAT list + drawer + manual entry | `dsat.list`, `dsat.get`, `responses.createManual` |
| `/tracker` | Escalations / RCA / actions | `escalations.listDetailed`, `rca.tracker`, `actions.*` |
| `/access` | Membership admin | `users.list`, `grantMembership`, `revokeMembership` |
| `/actionables` | Redirect → `/tracker` | — |

Capability checks: `requireCapability` + shared RBAC matrix. Audit logs on membership and workflow mutations.

## Seed / demo / CSV export

```bash
# Core org (networks, agencies including Foxy, accounts)
pnpm --filter @zoo/db db:seed

# Demo responses (asymmetric TSL vs Foxy profiles), escalations, RCAs, actions + rollups
pnpm --filter @zoo/api demo:seed   # or the script name in package.json

# Form-shaped CSVs for stakeholders
pnpm --filter @zoo/api exec tsx src/export-demo-form-csv.ts
```

Docs: [DEMO_DATA.md](DEMO_DATA.md), [DEMO_SURVEY_RESPONSES.md](DEMO_SURVEY_RESPONSES.md).

## Local development

```bash
pnpm install
# migrate + seed as needed
pnpm --filter @zoo/api dev
pnpm --filter @zoo/web dev
```

Run API tests (needs test DB): `pnpm --filter @zoo/api test`.

## Extending safely

1. Put new enums / formulas in `@zoo/shared` first.
2. Never accept client scope without `resolveVisibleAccounts` / `intersectWithScope`.
3. Keep charts in Recharts (no Three.js metrics). Pair colour with text labels.
4. Prefer extending existing routers over parallel “admin-only” paths that skip audit.
