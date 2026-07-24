/**
 * Exports the deterministic demo survey answers as a Google-Form-shaped CSV.
 * Replays the same scoring rules as demo-data.ts (no DB required).
 *
 * Usage: pnpm --filter @zoo/api exec tsx src/export-demo-form-csv.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Profile = 'healthy' | 'struggling' | 'middling'

const MONTHS_BACK = 6

const DEMO_ACCOUNTS = [
  { name: 'Aurora Foods', agency: 'Demo Agency', profile: 'healthy' as Profile },
  { name: 'Borealis Bank', agency: 'Demo Agency', profile: 'struggling' as Profile },
  { name: 'Cirrus Tech', agency: 'Demo Agency', profile: 'middling' as Profile },
  { name: 'Delta Retail', agency: 'Demo Agency', profile: 'healthy' as Profile },
  { name: 'Everest Media', agency: 'Demo Agency', profile: 'struggling' as Profile },
]

const REAL_ACCOUNTS = [
  { name: 'Mogu Mogu', agency: 'The Starter Labs', profile: 'healthy' as Profile },
  { name: 'Chemistry', agency: 'The Starter Labs', profile: 'struggling' as Profile },
  { name: 'Inkspired', agency: 'The Starter Labs', profile: 'middling' as Profile },
  { name: 'SOA', agency: 'The Starter Labs', profile: 'struggling' as Profile },
  { name: 'The Croffle Guys', agency: 'The Starter Labs', profile: 'healthy' as Profile },
  { name: 'Anemos', agency: 'The Starter Labs', profile: 'middling' as Profile },
  { name: 'WhiteOak', agency: 'The Starter Labs', profile: 'healthy' as Profile },
  { name: 'BuildWell', agency: 'The Starter Labs', profile: 'struggling' as Profile },
]

const CSAT_HEADERS = [
  'Timestamp',
  'Agency',
  'Account',
  'How satisfied were you with the Deliverables you received this quarter?',
  'How satisfied were you with the quality of the work delivered?',
  'How satisfied were you with the frequency and clarity of updates from your Account Manager?',
  'How satisfied were you with the timeliness of delivery against agreed timelines?',
  'How easy was it to get your requests actioned or issues resolved this quarter?',
  'How satisfied were you with how proactively the team brought ideas, flagged risks, or spotted opportunities?',
  'Add any critical feedback you have for us, and let us know how we can improve the service for you.',
  'Headline CSAT (used in dashboard) = Q1',
  'Is DSAT (Q1 <= 3)?',
]

const NPS_HEADERS = [
  'Timestamp',
  'Agency',
  'Account',
  'How likely are you to recommend us to a colleague or peer?',
  'NPS band',
]

const DRIVER_FEEDBACK = [
  '',
  'A few deliverables needed rework before we could use them; quality was inconsistent.',
  "We'd like more frequent and clearer updates from our account manager.",
  'Some deliverables slipped past the agreed timelines this quarter.',
  'It took too long to get a couple of our requests actioned.',
  "We'd love the team to flag risks and bring proactive ideas more often.",
]
const POSITIVE_FEEDBACK =
  'Strong quarter overall — responsive team and dependable delivery. Keep it up.'

function csatScore(profile: Profile, i: number, n: number): number {
  const pattern: Record<Profile, number[]> = {
    healthy: [5, 4, 5, 4, 5, 3, 5, 4],
    struggling: [1, 3, 2, 4, 1, 2, 3, 1],
    middling: [3, 4, 2, 5, 3, 1, 4, 5],
  }
  return pattern[profile][(i + n) % pattern[profile].length]!
}

function npsScore(profile: Profile, i: number, n: number): number {
  const pattern: Record<Profile, number[]> = {
    healthy: [10, 9, 8, 10, 9, 7],
    struggling: [0, 3, 6, 2, 5, 4],
    middling: [9, 7, 6, 8, 10, 3],
  }
  return pattern[profile][(i + n) % pattern[profile].length]!
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function driverAnswers(headline: number, seed: number): number[] {
  const offsets = [0, -1, 1, -1, 0, 1]
  return offsets.map((base, k) =>
    k === 0 ? headline : clamp(headline + base + ((seed + k) % 3) - 1, 1, 5),
  )
}

function monthOffset(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 12))
}

function quarterOffset(now: Date, quarters: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + quarters * 3, 12))
}

function npsBand(score: number): string {
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

function csvEscape(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Match the demo seed test anchor so the export is stable and reviewable. */
const NOW = new Date('2026-07-23T12:00:00.000Z')

const targets = [...DEMO_ACCOUNTS, ...REAL_ACCOUNTS]
const csatRows: string[] = [CSAT_HEADERS.map(csvEscape).join(',')]
const npsRows: string[] = [NPS_HEADERS.map(csvEscape).join(',')]

for (const [accountIndex, target] of targets.entries()) {
  for (let monthsAgo = MONTHS_BACK - 1; monthsAgo >= 0; monthsAgo -= 1) {
    const when = monthOffset(NOW, -monthsAgo)
    const count = 6 + ((accountIndex + monthsAgo) % 4)
    for (let n = 0; n < count; n += 1) {
      const overall = csatScore(target.profile, accountIndex + monthsAgo, n)
      const answers = driverAnswers(overall, accountIndex + monthsAgo + n)
      const isDsat = overall <= 3
      let feedback = ''
      if (isDsat || (accountIndex + monthsAgo + n) % 4 === 0) {
        const lowestDriver = answers.indexOf(Math.min(...answers))
        feedback = isDsat
          ? DRIVER_FEEDBACK[lowestDriver] || POSITIVE_FEEDBACK
          : POSITIVE_FEEDBACK
      }
      csatRows.push(
        [
          isoDate(when),
          target.agency,
          target.name,
          ...answers,
          feedback,
          overall,
          isDsat ? 'yes' : 'no',
        ]
          .map(csvEscape)
          .join(','),
      )
    }
  }

  for (const quartersAgo of [1, 0]) {
    const when = quarterOffset(NOW, -quartersAgo)
    for (let n = 0; n < 5; n += 1) {
      const score = npsScore(target.profile, accountIndex + quartersAgo, n)
      npsRows.push(
        [isoDate(when), target.agency, target.name, score, npsBand(score)]
          .map(csvEscape)
          .join(','),
      )
    }
  }
}

const root = resolve(process.cwd(), '../..')
const csatPath = resolve(root, 'demo-csat-form-responses.csv')
const npsPath = resolve(root, 'demo-nps-form-responses.csv')
writeFileSync(csatPath, csatRows.join('\n') + '\n')
writeFileSync(npsPath, npsRows.join('\n') + '\n')

console.log(`Wrote ${csatRows.length - 1} CSAT rows -> ${csatPath}`)
console.log(`Wrote ${npsRows.length - 1} NPS rows  -> ${npsPath}`)
