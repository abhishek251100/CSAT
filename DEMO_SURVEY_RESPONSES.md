# Demo survey responses (form-shaped)

This is the **dummy client survey data** behind the dashboard — shaped like your Google CSAT sheet so you can audit the numbers.

## Files to open / share

| File | What it is |
|------|------------|
| [`demo-csat-form-responses.csv`](demo-csat-form-responses.csv) | **763** CSAT form responses (TSL + Foxy + Demo Agency) |
| [`demo-nps-form-responses.csv`](demo-nps-form-responses.csv) | **170** NPS responses (separate instrument) |
| [`demo-data-summary.csv`](demo-data-summary.csv) | Per-account totals (responses / escalations / RCAs / actions) |

Regenerate after changing seed logic:

```bash
pnpm --filter @zoo/api exec tsx src/export-demo-form-csv.ts
```

(Anchored to seed date **2026-07-23**, same as tests — so the CSV is stable.)

---

## How this maps to your Google Form

Your sheet columns ↔ demo:

| Your form column | Demo role | Used in dashboard CSAT % / DSAT? |
|------------------|-----------|----------------------------------|
| Timestamp | `Timestamp` | Period bucketing only |
| How satisfied were you with the Deliverables… (overall) | **Q1** | **Yes — this is the only headline score** |
| Quality of the work | Q2 | Driver breakdown only (not averaged into CSAT %) |
| Frequency/clarity of AM updates | Q3 | Driver only |
| Timeliness of delivery | Q4 | Driver only |
| Ease of getting requests actioned | Q5 | Driver only |
| Proactivity (ideas / risks / opportunities) | Q6 | Driver only |
| Critical feedback (text) | Comment | Shown in workflow / qualitative review; not a metric |

**Rule (matches your product definition):**  
`survey_responses.score` = **Q1 only**.  
CSAT % = share of responses with Q1 in **{4, 5}**.  
DSAT = Q1 in **{1, 2, 3}**.

NPS is a **separate** survey (not one of the six CSAT questions):  
*“How likely are you to recommend us to a colleague or peer?”* (0–10).

---

## Who answered (accounts with demo form data)

### Demo Agency (fake brands)
Aurora Foods, Borealis Bank, Cirrus Tech, Delta Retail, Everest Media

### The Starter Labs (real client names + demo answers)
Mogu Mogu, Chemistry, Inkspired, SOA, The Croffle Guys, Anemos, WhiteOak, BuildWell

### Foxy (real agency + demo answers — mostly struggling)
Foxy Retail Co, Foxy Hospitality, Foxy Fintech, Foxy Health

### Real TSL accounts with **no** demo responses (0 form rows)
AJ, Alka Seltzer, EPCH, HyKr Venture Studio, Ryan, Spunge, Standard Chartered, Sunteck

**Global** scope in the UI pools every account you can see (TSL + Foxy + Demo Agency when seeded and granted).
---

## Sample rows (what one “form fill” looks like)

**CSAT — Mogu Mogu (healthy profile)**

| Timestamp | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Feedback | Headline | DSAT? |
|-----------|----|----|----|----|----|----|----------|----------|-------|
| 2026-02-12 | 5 | 5 | 5 | 4 | 5 | 5 | (empty or positive) | **5** | no |

**NPS — Aurora Foods**

| Timestamp | Score | Band |
|-----------|-------|------|
| 2026-04-12 | 9 | promoter |

Open the CSVs in Excel/Sheets for the full export (includes Foxy after the delivery overhaul).

---

## How scores are generated (so you can trust the math)

Not random. Each account has a **health profile** that cycles fixed patterns:

| Profile | CSAT Q1 pattern (1–5) | NPS pattern (0–10) | Accounts |
|---------|------------------------|--------------------|----------|
| Healthy | 5,4,5,4,5,3,5,4 | 10,9,8,10,9,7 | Aurora, Delta, Mogu Mogu, Croffle Guys, WhiteOak, Anemos |
| Struggling | 1,3,2,4,1,2,3,1 | 0,3,6,2,5,4 | Borealis, Everest, Chemistry, Foxy Retail / Hospitality / Health |
| Middling | 3,4,2,5,3,1,4,5 | 9,7,6,8,10,3 | Cirrus, Inkspired, SOA, BuildWell, Foxy Fintech |

- **~6 months** of CSAT (about **6–9 responses per account per month**)
- **2 quarters** of NPS (**5 responses per account per quarter**)
- Q2–Q6 are nudged around Q1 so drivers look coherent (not six independent scores)
- Written feedback: always on DSATs; sometimes on happy responses

Code: `apps/api/src/demo/demo-data.ts` (`csatScore`, `driverAnswers`, `npsScoreValue`).

---

## How the dashboard uses these values

1. Each CSV CSAT row → one `survey_responses` row with `score = Q1`, plus `response_answers` for Q1–Q6 (+ text).
2. Rollup job writes `metric_rollups` (CSAT %, NPS, DSAT count, response count, …).
3. View 1 (CX metrics) / DSAT / A tracker read rollups (and live scans only for custom date ranges).

If the live Neon DB was seeded with `demo:seed` on a different day, dates shift relative to “today”, but the **same patterns and volumes** apply. To align DB with these CSVs, re-seed with a fixed clock or re-run export after seed.

---

## Quick check you can do yourself

1. Open `demo-csat-form-responses.csv` in Sheets.
2. Filter Account = `Chemistry` (struggling).
3. Count Q1 ≤ 3 → those are DSATs; CSAT % for that filter ≈ (rows with Q1≥4) / (all Chemistry CSAT rows).
4. Compare to dashboard Account scope → Chemistry for the same months.
