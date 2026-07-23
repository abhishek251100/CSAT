import type { RoleKey, ScopeType } from './enums'

/**
 * RBAC core — SPEC.md §5. The single definition of who can see and do what.
 *
 * Everything here is pure. The database-backed wrapper that loads memberships
 * and the org tree lives in apps/api; this module holds only the resolution
 * rules, so they can be exhaustively tested with fixtures and shared with the
 * UI (§9 limits the scope switcher and hides unavailable actions using the same
 * rules the server enforces).
 *
 * Sharing these functions is not a weakening of enforcement. Enforcement is
 * server-side and mandatory (§12: "no trust in client-sent scope"); the client
 * merely avoids rendering what it would be refused.
 */

/** A row of `memberships` (§4.3), reduced to what scope resolution needs. */
export interface ScopeMembership {
  readonly scopeType: ScopeType
  readonly scopeId: string
  readonly role: RoleKey
}

/**
 * The org hierarchy needed to expand a network or agency grant into accounts.
 *
 * Callers pass only live rows — soft-deleted accounts (§4.1) must be filtered
 * out before this is called, so deletion policy stays in the query layer rather
 * than being reimplemented here.
 */
export interface OrgStructure {
  readonly agencies: readonly { readonly id: string; readonly networkId: string }[]
  readonly accounts: readonly { readonly id: string; readonly agencyId: string }[]
}

/**
 * Resolves the set of account ids a user may see — the core of §5.2.
 *
 * - a `network` membership grants every account in that network
 * - an `agency` membership grants that agency's accounts
 * - an `account` membership grants exactly those accounts
 *
 * Grants union, so the widest membership wins. Closed by default: no
 * membership means no access, and a membership pointing at a scope that no
 * longer exists contributes nothing. That matters because `scope_id` is a soft
 * FK (§4.3) — the database cannot stop a stale grant, so this must not widen
 * access or throw when it meets one.
 *
 * Returns a sorted array rather than a Set so results are deterministic, easy
 * to assert, and ready to hand to a SQL `IN` clause.
 */
export function resolveVisibleAccountIds(
  memberships: readonly ScopeMembership[],
  org: OrgStructure,
): string[] {
  if (memberships.length === 0) return []

  const networkGrants = new Set<string>()
  const agencyGrants = new Set<string>()
  const accountGrants = new Set<string>()

  for (const { scopeType, scopeId } of memberships) {
    if (scopeType === 'network') networkGrants.add(scopeId)
    else if (scopeType === 'agency') agencyGrants.add(scopeId)
    else accountGrants.add(scopeId)
  }

  // Expand network grants down to agencies, so both tiers reduce to one check.
  const agenciesInScope = new Set(agencyGrants)
  for (const agency of org.agencies) {
    if (networkGrants.has(agency.networkId)) agenciesInScope.add(agency.id)
  }

  const visible = new Set<string>()
  for (const account of org.accounts) {
    if (agenciesInScope.has(account.agencyId) || accountGrants.has(account.id)) {
      visible.add(account.id)
    }
  }

  return [...visible].sort()
}

/**
 * Every role a user holds over a given account, across all their memberships.
 *
 * A user can reach one account through more than one grant — a network
 * membership as viewer and an account membership as account_manager, say — and
 * a capability check should consider all of them. Returns empty when the
 * account is not visible at all.
 */
export function rolesForAccount(
  memberships: readonly ScopeMembership[],
  accountId: string,
  org: OrgStructure,
): RoleKey[] {
  const account = org.accounts.find((candidate) => candidate.id === accountId)
  if (!account) return []

  const agency = org.agencies.find((candidate) => candidate.id === account.agencyId)

  const roles = new Set<RoleKey>()

  for (const membership of memberships) {
    const grants =
      (membership.scopeType === 'account' && membership.scopeId === accountId) ||
      (membership.scopeType === 'agency' && membership.scopeId === account.agencyId) ||
      (membership.scopeType === 'network' && membership.scopeId === agency?.networkId)

    if (grants) roles.add(membership.role)
  }

  return [...roles]
}

/**
 * The capability vocabulary, one per row of the §5.3 matrix.
 */
export const CAPABILITIES = [
  'view_metrics',
  'view_network',
  /**
   * ADDITION beyond §5.3: manual response entry (§8).
   *
   * The matrix has no row for it — it predates the manual-entry path — but
   * injecting CSAT and NPS scores changes every headline number, so it cannot
   * default to "anyone who can read". Granted to the same roles that hold the
   * other workflow writes, which excludes team_member and viewer.
   * Flagged for confirmation.
   */
  'enter_response',
  'create_escalation',
  /**
   * Resolving or closing an escalation (§5.3, by decision).
   *
   * Split from `create_escalation`: a manager may raise an escalation but not
   * declare it resolved or closed — that is a director-and-up judgement, so it
   * cannot be quietly self-closed by whoever filed it.
   */
  'resolve_escalation',
  'author_rca',
  'create_action_item',
  'update_own_action_item',
  'close_others_action_item',
  'manage_accounts',
  'manage_users',
  'trigger_sync',
  'platform_config',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * The permission matrix from §5.3, transcribed verbatim.
 *
 * One note on "Manage users / memberships", which §5.3 marks "scope only" for
 * agency_admin rather than Y or N. It is expressed here as a plain capability,
 * because scope is already applied independently: every query an agency_admin
 * makes is confined to their agency by `resolveVisibleAccountIds`. Modelling a
 * third "scope only" state would duplicate a restriction the scope middleware
 * enforces regardless, and give two places to get it wrong.
 */
const MATRIX: Record<Capability, ReadonlySet<RoleKey>> = {
  view_metrics: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
    'team_member',
    'viewer',
  ]),
  view_network: new Set(['super_admin', 'network_admin']),
  enter_response: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
  ]),
  create_escalation: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
  ]),
  // Director and up; deliberately excludes account_manager.
  resolve_escalation: new Set(['super_admin', 'network_admin', 'agency_admin', 'account_director']),
  author_rca: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
  ]),
  create_action_item: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
  ]),
  update_own_action_item: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
    'account_manager',
    'team_member',
  ]),
  close_others_action_item: new Set([
    'super_admin',
    'network_admin',
    'agency_admin',
    'account_director',
  ]),
  manage_accounts: new Set(['super_admin', 'network_admin', 'agency_admin']),
  manage_users: new Set(['super_admin', 'network_admin', 'agency_admin']),
  trigger_sync: new Set(['super_admin', 'network_admin', 'agency_admin']),
  platform_config: new Set(['super_admin']),
}

/** Does this role hold this capability? (§5.3) */
export function can(role: RoleKey, capability: Capability): boolean {
  return MATRIX[capability].has(role)
}

/** Does any of these roles hold the capability? */
export function canAny(roles: readonly RoleKey[], capability: Capability): boolean {
  return roles.some((role) => can(role, capability))
}
