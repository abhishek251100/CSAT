import type { AppDb } from '@zoo/db'
import { accounts, agencies, escalations, metricRollups, surveyResponses } from '@zoo/db/schema'
import {
  computeRollupMetrics,
  currentAndPreviousPeriods,
  METRIC_KEYS,
  periodBoundsUtc,
  periodsFor,
  type MetricResponse,
  type Period,
  type ScopeType,
} from '@zoo/shared'
import { and, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

/**
 * Rollup recomputation — SPEC.md §4.3, §6, §12.
 *
 * §4.3: "A cron recomputes the current and previous period on a schedule and on
 * write." §12: "dashboards read `metric_rollups`; raw scans only for custom
 * ranges."
 *
 * This module does I/O and nothing else. Every number it stores comes from
 * `computeRollupMetrics` in @zoo/shared, which in turn calls the metric
 * functions in §6 — there is no SQL aggregate anywhere in this file, because a
 * second implementation in SQL is exactly the drift §3 forbids.
 *
 * Aggregation is response-weighted by construction (confirmed decision #3): an
 * agency rollup is computed by handing the metric functions every response from
 * every account in that agency, not by averaging per-account figures.
 */

export interface RecomputeSummary {
  readonly scopesRecomputed: number
  readonly periodsRecomputed: number
  readonly rowsUpserted: number
}

interface ScopeTarget {
  readonly scopeType: ScopeType
  readonly scopeId: string
  /** Every account pooled into this scope. */
  readonly accountIds: readonly string[]
}

/**
 * Recomputes every scope touched by the given accounts, for the given periods.
 *
 * Walks *up* the hierarchy: changing one account's responses changes that
 * account's rollup, its agency's, and its network's. Each higher tier is
 * recomputed over all of its accounts, not just the ones that changed —
 * otherwise the pooled figure would be computed from a partial set.
 */
export async function recomputeRollups(
  db: AppDb,
  options: { accountIds: readonly string[]; periods: readonly Period[] },
): Promise<RecomputeSummary> {
  const { periods } = options
  const seedAccountIds = [...new Set(options.accountIds)]

  if (seedAccountIds.length === 0 || periods.length === 0) {
    return { scopesRecomputed: 0, periodsRecomputed: 0, rowsUpserted: 0 }
  }

  const [agencyRows, accountRows] = await Promise.all([
    db.select({ id: agencies.id, networkId: agencies.networkId }).from(agencies),
    db
      .select({ id: accounts.id, agencyId: accounts.agencyId })
      .from(accounts)
      .where(isNull(accounts.deletedAt)),
  ])

  const targets = buildScopeTargets(seedAccountIds, agencyRows, accountRows)

  if (targets.length === 0) {
    return { scopesRecomputed: 0, periodsRecomputed: 0, rowsUpserted: 0 }
  }

  // Union of every account involved, so each period costs two queries rather
  // than two per scope.
  const allAccountIds = [...new Set(targets.flatMap((target) => [...target.accountIds]))]

  let rowsUpserted = 0

  for (const period of periods) {
    const { startAt, endAtExclusive } = periodBoundsUtc(period)

    const [responseRows, escalationRows] = await Promise.all([
      db
        .select({
          accountId: surveyResponses.accountId,
          type: surveyResponses.type,
          score: surveyResponses.score,
        })
        .from(surveyResponses)
        .where(
          and(
            inArray(surveyResponses.accountId, allAccountIds),
            isNull(surveyResponses.deletedAt),
            gte(surveyResponses.submittedAt, startAt),
            lt(surveyResponses.submittedAt, endAtExclusive),
          ),
        ),
      db
        .select({ accountId: escalations.accountId })
        .from(escalations)
        .where(
          and(
            inArray(escalations.accountId, allAccountIds),
            isNull(escalations.deletedAt),
            gte(escalations.reportedAt, startAt),
            lt(escalations.reportedAt, endAtExclusive),
          ),
        ),
    ])

    const responsesByAccount = groupBy(responseRows, (row) => row.accountId)
    const escalationsByAccount = groupBy(escalationRows, (row) => row.accountId)

    /**
     * Every scope's rows for this period are upserted in one statement.
     *
     * One statement per scope would be 6 metrics x 18 scopes x 4 periods of
     * round trips against Neon's HTTP driver, which measured at ~18s for the
     * seeded network. Batching per period brings it to one round trip per
     * period. The values themselves are still computed per scope by the shared
     * metric functions — only the write is batched.
     */
    const rows = targets.flatMap((target) => {
      const responses: MetricResponse[] = target.accountIds.flatMap((accountId) =>
        (responsesByAccount.get(accountId) ?? []).map((row) => ({
          type: row.type,
          score: row.score,
        })),
      )

      const escalationCount = target.accountIds.reduce(
        (total, accountId) => total + (escalationsByAccount.get(accountId)?.length ?? 0),
        0,
      )

      const metrics = computeRollupMetrics(responses, escalationCount)

      return METRIC_KEYS.map((metric) => ({
        scopeType: target.scopeType,
        scopeId: target.scopeId,
        metric,
        periodGrain: period.grain,
        periodStart: period.start,
        periodEnd: period.end,
        /**
         * `numeric` round-trips as a string in Drizzle. Storing the number as a
         * string preserves the exact decimal rather than passing it through a
         * float, which is the point of §4.1's "no floats for scores".
         */
        value: metrics[metric].value === null ? null : String(metrics[metric].value),
        sampleSize: metrics[metric].sampleSize,
      }))
    })

    if (rows.length === 0) continue

    await db
      .insert(metricRollups)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          metricRollups.scopeType,
          metricRollups.scopeId,
          metricRollups.metric,
          metricRollups.periodGrain,
          metricRollups.periodStart,
        ],
        set: {
          value: sql`excluded.value`,
          sampleSize: sql`excluded.sample_size`,
          periodEnd: sql`excluded.period_end`,
          computedAt: new Date(),
        },
      })

    rowsUpserted += rows.length
  }

  return {
    scopesRecomputed: targets.length,
    periodsRecomputed: periods.length,
    rowsUpserted,
  }
}

/**
 * Expands a set of changed accounts into every scope whose figures they affect.
 */
function buildScopeTargets(
  seedAccountIds: readonly string[],
  agencyRows: readonly { id: string; networkId: string }[],
  accountRows: readonly { id: string; agencyId: string }[],
): ScopeTarget[] {
  const agencyOfAccount = new Map(accountRows.map((row) => [row.id, row.agencyId]))
  const networkOfAgency = new Map(agencyRows.map((row) => [row.id, row.networkId]))

  const accountsByAgency = groupBy(accountRows, (row) => row.agencyId)

  const affectedAgencyIds = new Set<string>()
  for (const accountId of seedAccountIds) {
    const agencyId = agencyOfAccount.get(accountId)
    if (agencyId) affectedAgencyIds.add(agencyId)
  }

  const affectedNetworkIds = new Set<string>()
  for (const agencyId of affectedAgencyIds) {
    const networkId = networkOfAgency.get(agencyId)
    if (networkId) affectedNetworkIds.add(networkId)
  }

  const targets: ScopeTarget[] = []

  // Account tier — only the accounts that actually changed.
  for (const accountId of seedAccountIds) {
    // Skip an id that is soft-deleted or does not exist; a stale reference must
    // not create a rollup for a scope that is not there.
    if (!agencyOfAccount.has(accountId)) continue

    targets.push({ scopeType: 'account', scopeId: accountId, accountIds: [accountId] })
  }

  // Agency tier — pooled over ALL of the agency's accounts.
  for (const agencyId of affectedAgencyIds) {
    targets.push({
      scopeType: 'agency',
      scopeId: agencyId,
      accountIds: (accountsByAgency.get(agencyId) ?? []).map((row) => row.id),
    })
  }

  // Network tier — pooled over every account in every agency of the network.
  for (const networkId of affectedNetworkIds) {
    const accountIds = agencyRows
      .filter((agency) => agency.networkId === networkId)
      .flatMap((agency) => (accountsByAgency.get(agency.id) ?? []).map((row) => row.id))

    targets.push({ scopeType: 'network', scopeId: networkId, accountIds })
  }

  return targets
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()

  for (const item of items) {
    const bucket = grouped.get(key(item))

    if (bucket) bucket.push(item)
    else grouped.set(key(item), [item])
  }

  return grouped
}

/**
 * On-write recomputation — called after a response lands.
 *
 * Recomputes the periods containing *that response's* `submitted_at`, not the
 * current date. Manual entry is routinely backdated (§8), and recomputing
 * "now" would leave the month the response actually belongs to untouched.
 */
export async function recomputeForResponse(
  db: AppDb,
  accountId: string,
  submittedAt: Date,
): Promise<RecomputeSummary> {
  return recomputeRollups(db, { accountIds: [accountId], periods: periodsFor(submittedAt) })
}

/**
 * Scheduled recomputation — the cron entry point (§4.3).
 *
 * Recomputes the current and previous period at both grains, across every live
 * account. The previous period is included because late-arriving responses,
 * corrections and soft deletes can change a period after it has closed.
 *
 * The trigger is still open: §16 #6 (hosting) decides whether this is Vercel
 * Cron, Workers Cron Triggers, or a GitHub Action hitting an authenticated
 * endpoint. Until then it is invoked by `pnpm --filter @zoo/api rollups:cron`.
 */
export async function recomputeCurrentAndPrevious(
  db: AppDb,
  now: Date = new Date(),
): Promise<RecomputeSummary> {
  const liveAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(isNull(accounts.deletedAt))

  return recomputeRollups(db, {
    accountIds: liveAccounts.map((account) => account.id),
    periods: currentAndPreviousPeriods(now),
  })
}
