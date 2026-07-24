# Zoo Media CX — Demo Data & Access Guide

Share this with stakeholders reviewing the tool. It describes what populates the dashboards, how access works, and known product gaps.

---

## 1. Why someone can sign in but see an empty dashboard

**Signing in ≠ seeing data.**

| Step | What happens |
|------|----------------|
| Google / break-glass login | Creates a **session** (and a `users` row on first Google visit) |
| Domain allowlist | Only `@thestarterlabs.com` and `@zoomedia.com` (plus break-glass email) can sign in |
| Membership | A separate `memberships` row decides **which accounts** they can see |

If the banner says *"You have no account memberships yet…"*, the user is authenticated but has **zero memberships**. That is intentional (closed by default). There is **no admin UI yet** to grant access — an administrator must insert a membership (SQL below) or use the break-glass account.

### Grant network-wide access (recommended for reviewers)

After the person has signed in once (so a `users` row exists):

```bash
# From repo root, with DATABASE_URL pointing at Neon
pnpm --filter @zoo/api exec tsx src/grant-membership.ts tech@thestarterlabs.com network_admin
```

Or raw SQL:

```sql
-- 1) Find the user
SELECT id, email FROM users WHERE email = 'tech@thestarterlabs.com';

-- 2) Find the network
SELECT id, name FROM networks WHERE slug = 'zoo-media';

-- 3) Grant full network visibility (network_admin)
INSERT INTO memberships (id, user_id, scope_type, scope_id, role, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  '<user_id from step 1>',
  'network',
  '<network_id from step 2>',
  'network_admin',
  now(),
  now()
);
```

Then hard-refresh the dashboard. Scope should offer **Zoo Media** (network) and populate accounts.

### Break-glass (platform owner)

```bash
pnpm --filter @zoo/api auth:seed-admin
```

Signs in with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (email form on `/sign-in`). Auto-gets `super_admin` at network tier. Does **not** use Google.

---

## 2. Org structure (always present after `db:seed`)

| Tier | Name | Slug | Notes |
|------|------|------|--------|
| Network | Zoo Media | `zoo-media` | Real |
| Agency | The Starter Labs | `the-starter-labs` | Real — 16 client accounts |
| Agency | Demo Agency | `demo-agency` | **Demo only** (`is_demo = true`) — 5 fake brands |

### 16 real TSL accounts (client brands)

Mogu Mogu, Chemistry, Inkspired, SOA, The Croffle Guys, Anemos, Standard Chartered, WhiteOak, Alka Seltzer, BuildWell, Spunge, EPCH, AJ, Ryan, HyKr Venture Studio, Sunteck.

These rows stay `is_demo = false`. Some of them receive **demo survey responses** (see below); the account records themselves are not deleted when demo data is purged.

---

## 3. Demo / dummy data (what fills the charts)

### How to load / remove

```bash
pnpm --filter @zoo/db db:seed          # network + agencies + 16 accounts (no responses)
pnpm --filter @zoo/api demo:seed       # purge + seed demo responses/workflow + recompute rollups
pnpm --filter @zoo/api demo:purge      # remove only is_demo rows
```

`demo:seed` / `demo:purge` **refuse to run when `NODE_ENV=production`**. For production Neon, run them from a machine with `NODE_ENV` unset or `development`, pointing `DATABASE_URL` at that Neon DB.

Source of truth in code: `apps/api/src/demo/demo-data.ts`.  
CSV snapshots (if present): `demo-data-summary.csv`, `demo-data-responses.csv`.

### What it adds (all flagged `is_demo = true`)

| Piece | Detail |
|-------|--------|
| Demo Agency | Under Zoo Media, with 5 accounts |
| Demo accounts | Aurora Foods, Borealis Bank, Cirrus Tech, Delta Retail, Everest Media |
| Also seeded on 8 real TSL accounts | Mogu Mogu, Chemistry, Inkspired, SOA, The Croffle Guys, Anemos, WhiteOak, BuildWell |
| Left empty (no demo responses) | AJ, Alka Seltzer, EPCH, HyKr, Ryan, Spunge, Standard Chartered, Sunteck |
| CSAT | ~6 months of monthly responses; headline score = **Q1 overall satisfaction** (1–5); Q2–Q6 = drivers; plus free-text feedback |
| NPS | Separate instrument; ~2 quarters; score 0–10 |
| Escalations | Mix of severities, channels, statuses across both agencies |
| RCAs | People / process / product; five whys + fishbone; from escalations + first DSAT per account (other DSATs stay “pending RCA”) |
| Action items | Owners, ETAs, mixed statuses; some overdue |

### Approximate inventory (from last summary CSV)

| Agency | Accounts with data | Responses | Escalations | RCAs | Actions |
|--------|--------------------|-----------|-------------|------|---------|
| Demo Agency | 5 | ~273 | ~7 | ~12 | ~12 |
| The Starter Labs (8 of 16) | 8 | ~440 | ~12 | ~20 | ~20 |
| **Total demo-flagged** | **13 targets** | **~713** | **~19** | **~32** | **~32** |

Health profiles (so the leaderboard spreads):

| Profile | Demo accounts | Real TSL accounts |
|---------|---------------|-------------------|
| Healthy | Aurora Foods, Delta Retail | Mogu Mogu, The Croffle Guys, WhiteOak |
| Middling | Cirrus Tech | Inkspired, Anemos |
| Struggling | Borealis Bank, Everest Media | Chemistry, SOA, BuildWell |

### Metrics methodology (matches product docs)

- **CSAT %** = share of responses scoring **4 or 5** (headline = Q1 only; drivers never averaged into the headline).
- **DSAT** = overall score **1–3** (derived; not a separate table).
- **NPS** = % promoters − % detractors (promoters 9–10, passives 7–8, detractors 0–6).
- Dashboards read precomputed **`metric_rollups`**, not raw rows, for monthly/quarterly views.
- Network / agency rollups are **response-weighted** (large accounts move the number more).

---

## 4. What reviewers should click through

1. Sign in (Google on allowlisted domain **with membership**, or break-glass).
2. **Satisfaction & Loyalty** (`/`) — KPIs, CSAT/NPS trends, bands, distribution, account leaderboard.
3. Switch scope: Account → Agency (TSL vs Demo Agency) → Network (Zoo Media) and confirm numbers differ.
4. **Feedback & Actionables** (`/actionables`) — open escalations, DSAT count, overdue actions, error-category pie, RCA tracker.

---

## 5. Known product gaps / confusing spots (not deployment bugs)

| Issue | Notes |
|-------|--------|
| No “grant membership” UI | Spec’d; not built yet. Grant via SQL or break-glass only. |
| Empty membership banner mainly on View 1 | View 2 can look “empty” without the same amber explanation. |
| View 2 date range | KPI / pie honor the period; escalation / action **lists** are scope-filtered only (not date-filtered). Period controls there can feel misleading. |
| Dates in 2026 | Environment clock / seed window; demo is relative to “today” at seed time (~last 6 months). |
| Partial account grants | Agency/network aggregate options only appear if the user can see **all** accounts in that scope (anti-leak rule). |
| Sparkline on KPI cards | Spec mentions trend sparkline; UI shows delta text, not a sparkline. |
| Average CSAT | Spec secondary metric; not shown as its own KPI on View 1. |

---

## 6. Quick FAQ

**Q: Google login works but dashboard is blank.**  
A: Grant a `memberships` row (section 1). Domain login alone is not enough.

**Q: Is demo data production-safe to purge?**  
A: Yes — only `is_demo = true` rows. Real network, TSL agency, and 16 account rows remain.

**Q: Do the 16 Google Forms sync into the app today?**  
A: Not yet (Milestone 8). Current charts are **demo seed + any manual entry**, not live Forms sync.
