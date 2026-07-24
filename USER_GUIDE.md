# Zoo Media CX — User Guide

A plain-language guide to the client CX tool.

## Sign in

1. Open the app (production: [csat-web.vercel.app](https://csat-web.vercel.app)).
2. Sign in with Google using an allowed company email (`@thestarterlabs.com` or `@zoomedia.com`), or use break-glass if your admin gave you that option.
3. **Signing in is not the same as seeing data.** An admin must also grant you a **membership** (which network, agency, or brand you can see). If you see “no account memberships”, ask an admin to open **Access** and grant you one.

## Scopes (what you are looking at)

Use the sticky filter bar at the top of every tab:

| Scope | Meaning |
|-------|---------|
| **Global** | Every brand you are allowed to see, pooled together |
| **Network** | One network (e.g. Zoo Media) — all agencies under it |
| **Agency** | One agency (e.g. The Starter Labs or Foxy) |
| **Account / Brand** | One client brand |

Also pick a **period** (monthly / quarterly / custom) and from/to dates. The chip under the header always shows what you are viewing so you do not lose context while scrolling.

At **Network** or **Global**, an **Agency performance** table compares agencies (e.g. TSL vs Foxy) so you can see which book is healthy and which is struggling.

Filters are remembered while you move between tabs in the same browser session.

## The three tabs

### 1. CX metrics

High-level health:

- **CSAT %** — share of CSAT responses scoring 4 or 5 (headline satisfaction)
- **CSAT** — count of CSAT responses only
- **NPS** — promoters minus detractors (−100 to +100)
- **DSAT rate** — share of CSAT responses scoring 1–3

Charts: CSAT trend and distribution on the left; NPS mix and brand scores on the right. Click a brand name to drill into that account.

### 2. DSAT

List of dissatisfied responses (Q1 ≤ 3) for the selected scope and period:

- Who submitted (when known), brand, agency, Q1 score, RCA status, feedback snippet
- Click a row for driver answers (Q1–Q6), comment, and linked RCA
- If your role allows, use **Manual response entry** to record a CSAT score by hand (your name is attributable via the audit trail / respondent fields)

### 3. A tracker

Operations workspace:

- **Escalations** table with numbers (`ESC-0001`…), severity, status, RCA status, category
- **RCA status tracker** and error-category mix
- **Action items** with overdue flags
- Roles with permission can **Create escalation** from this tab

## How to read CSAT vs DSAT vs NPS

| Term | Meaning |
|------|---------|
| CSAT | Client satisfaction survey (score 1–5). Headline % uses **overall Q1 only**. |
| DSAT | Dissatisfied: Q1 is 1, 2, or 3. Not a separate survey. |
| NPS | Separate loyalty question (0–10). Not mixed into CSAT %. |

Colour on KPI cards is a hint only — every card also has a text label.

## Escalations, RCA, and actions

1. Raise or find an escalation on **A tracker**.
2. Attach or complete an RCA (5 Whys / fishbone, error category) when your role allows.
3. Create action items with owners and ETAs; overdue items stay flagged until done.

## Admins: granting access

Users with **manage users** (typically super admin / network admin / agency admin) see an **Access** tab:

1. Pick the user (they must have signed in once).
2. Choose scope type (network / agency / account), the entity, and a role.
3. Grant. Revoke from the membership list when needed.

CLI alternative (same effect):

```bash
pnpm --filter @zoo/api exec tsx src/grant-membership.ts someone@thestarterlabs.com network_admin
```

## Demo data

Reviewers often look at seeded **demo** surveys for The Starter Labs and **Foxy**. See [DEMO_DATA.md](DEMO_DATA.md) and [DEMO_SURVEY_RESPONSES.md](DEMO_SURVEY_RESPONSES.md).
