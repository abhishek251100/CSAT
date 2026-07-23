import { describe, expect, it } from 'vitest'
import type { OrgStructure, ScopeMembership } from './rbac'
import { can, CAPABILITIES, resolveVisibleAccountIds, rolesForAccount } from './rbac'

/**
 * Fixture network — SPEC.md §5.2.
 *
 *   network-zoo
 *     agency-tsl          accounts: mogu, chemistry, soa
 *     agency-sibling      accounts: inkspired
 *   network-other
 *     agency-outside      accounts: outsider
 *
 * `outsider` exists to prove that a network membership does not leak across
 * networks, and `agency-sibling` to prove an agency membership does not leak
 * sideways within one.
 */
const org: OrgStructure = {
  agencies: [
    { id: 'agency-tsl', networkId: 'network-zoo' },
    { id: 'agency-sibling', networkId: 'network-zoo' },
    { id: 'agency-outside', networkId: 'network-other' },
  ],
  accounts: [
    { id: 'mogu', agencyId: 'agency-tsl' },
    { id: 'chemistry', agencyId: 'agency-tsl' },
    { id: 'soa', agencyId: 'agency-tsl' },
    { id: 'inkspired', agencyId: 'agency-sibling' },
    { id: 'outsider', agencyId: 'agency-outside' },
  ],
}

const membership = (
  scopeType: ScopeMembership['scopeType'],
  scopeId: string,
  role: ScopeMembership['role'] = 'viewer',
): ScopeMembership => ({ scopeType, scopeId, role })

describe('resolveVisibleAccountIds — network scope (§5.2)', () => {
  it('sees every account under that network, across all its agencies', () => {
    expect(resolveVisibleAccountIds([membership('network', 'network-zoo')], org)).toEqual([
      'chemistry',
      'inkspired',
      'mogu',
      'soa',
    ])
  })

  it('does not leak into a sibling network', () => {
    const visible = resolveVisibleAccountIds([membership('network', 'network-zoo')], org)

    expect(visible).not.toContain('outsider')
  })
})

describe('resolveVisibleAccountIds — agency scope (§5.2)', () => {
  it('sees only that agency’s accounts', () => {
    expect(resolveVisibleAccountIds([membership('agency', 'agency-tsl')], org)).toEqual([
      'chemistry',
      'mogu',
      'soa',
    ])
  })

  it('does not see a sibling agency inside the same network', () => {
    // The case §5.3 cares most about: agency_admin is scoped to their agency.
    const visible = resolveVisibleAccountIds(
      [membership('agency', 'agency-tsl', 'agency_admin')],
      org,
    )

    expect(visible).not.toContain('inkspired')
    expect(visible).not.toContain('outsider')
  })
})

describe('resolveVisibleAccountIds — account scope (§5.2)', () => {
  it('sees exactly the granted accounts', () => {
    const visible = resolveVisibleAccountIds(
      [membership('account', 'mogu'), membership('account', 'inkspired')],
      org,
    )

    expect(visible).toEqual(['inkspired', 'mogu'])
  })

  it('does not widen to the rest of the account’s agency', () => {
    const visible = resolveVisibleAccountIds([membership('account', 'mogu')], org)

    expect(visible).toEqual(['mogu'])
  })
})

describe('resolveVisibleAccountIds — multiple memberships', () => {
  it('unions across tiers', () => {
    const visible = resolveVisibleAccountIds(
      [membership('agency', 'agency-sibling'), membership('account', 'mogu')],
      org,
    )

    expect(visible).toEqual(['inkspired', 'mogu'])
  })

  it('deduplicates when tiers overlap', () => {
    // An agency grant plus an explicit account grant inside it.
    const visible = resolveVisibleAccountIds(
      [membership('agency', 'agency-tsl'), membership('account', 'mogu')],
      org,
    )

    expect(visible).toEqual(['chemistry', 'mogu', 'soa'])
  })

  it('takes the widest grant when a narrow and a broad one overlap', () => {
    const broad = resolveVisibleAccountIds([membership('network', 'network-zoo')], org)
    const both = resolveVisibleAccountIds(
      [membership('network', 'network-zoo'), membership('account', 'mogu')],
      org,
    )

    expect(both).toEqual(broad)
  })
})

describe('resolveVisibleAccountIds — closed by default', () => {
  it('returns nothing for a user with no memberships', () => {
    // The security-critical default: absent configuration grants no access.
    expect(resolveVisibleAccountIds([], org)).toEqual([])
  })

  it('ignores a membership pointing at a scope that does not exist', () => {
    // A stale grant must contribute nothing rather than throw or widen access.
    // scope_id is a soft FK (§4.3), so the database cannot prevent this.
    const visible = resolveVisibleAccountIds(
      [
        membership('network', 'network-deleted'),
        membership('agency', 'agency-deleted'),
        membership('account', 'account-deleted'),
      ],
      org,
    )

    expect(visible).toEqual([])
  })

  it('returns nothing when the org structure is empty', () => {
    expect(
      resolveVisibleAccountIds([membership('network', 'network-zoo')], {
        agencies: [],
        accounts: [],
      }),
    ).toEqual([])
  })

  it('is deterministic, returning a sorted list', () => {
    const visible = resolveVisibleAccountIds([membership('network', 'network-zoo')], org)

    expect(visible).toEqual([...visible].sort())
  })
})

describe('rolesForAccount', () => {
  it('collects every role granting access to an account', () => {
    const roles = rolesForAccount(
      [
        membership('network', 'network-zoo', 'network_admin'),
        membership('account', 'mogu', 'account_manager'),
      ],
      'mogu',
      org,
    )

    expect([...roles].sort()).toEqual(['account_manager', 'network_admin'])
  })

  it('returns nothing for an account the user cannot see', () => {
    const roles = rolesForAccount(
      [membership('agency', 'agency-tsl', 'agency_admin')],
      'outsider',
      org,
    )

    expect(roles).toEqual([])
  })
})

describe('can — permission matrix (§5.3)', () => {
  it('lets every role view metrics within scope', () => {
    for (const role of [
      'super_admin',
      'network_admin',
      'agency_admin',
      'account_director',
      'account_manager',
      'team_member',
      'viewer',
    ] as const) {
      expect(can(role, 'view_metrics')).toBe(true)
    }
  })

  it('restricts the network-level view to super_admin and network_admin', () => {
    expect(can('super_admin', 'view_network')).toBe(true)
    expect(can('network_admin', 'view_network')).toBe(true)
    expect(can('agency_admin', 'view_network')).toBe(false)
    expect(can('account_director', 'view_network')).toBe(false)
    expect(can('viewer', 'view_network')).toBe(false)
  })

  it('stops team_member and viewer creating escalations, RCAs and actions', () => {
    for (const capability of ['create_escalation', 'author_rca', 'create_action_item'] as const) {
      expect(can('account_manager', capability)).toBe(true)
      expect(can('team_member', capability)).toBe(false)
      expect(can('viewer', capability)).toBe(false)
    }
  })

  it('lets team_member update their own action item but not close someone else’s', () => {
    expect(can('team_member', 'update_own_action_item')).toBe(true)
    expect(can('team_member', 'close_others_action_item')).toBe(false)
  })

  it('stops account_manager closing someone else’s action item', () => {
    // The one place manager and director diverge in §5.3.
    expect(can('account_director', 'close_others_action_item')).toBe(true)
    expect(can('account_manager', 'close_others_action_item')).toBe(false)
  })

  it('lets a manager create an escalation but not resolve or close it', () => {
    // The escalation capability split: raising is manager-and-up, but
    // declaring it done is director-and-up.
    expect(can('account_manager', 'create_escalation')).toBe(true)
    expect(can('account_manager', 'resolve_escalation')).toBe(false)
    expect(can('account_director', 'resolve_escalation')).toBe(true)
    expect(can('agency_admin', 'resolve_escalation')).toBe(true)
    expect(can('team_member', 'resolve_escalation')).toBe(false)
  })

  it('gives viewer read-only access and nothing more', () => {
    expect(can('viewer', 'view_metrics')).toBe(true)

    for (const capability of CAPABILITIES) {
      if (capability === 'view_metrics') continue
      expect(can('viewer', capability)).toBe(false)
    }
  })

  it('reserves platform config for super_admin alone', () => {
    expect(can('super_admin', 'platform_config')).toBe(true)
    expect(can('network_admin', 'platform_config')).toBe(false)
    expect(can('agency_admin', 'platform_config')).toBe(false)
  })

  it('restricts account management to super, network and agency admins', () => {
    expect(can('super_admin', 'manage_accounts')).toBe(true)
    expect(can('network_admin', 'manage_accounts')).toBe(true)
    expect(can('agency_admin', 'manage_accounts')).toBe(true)
    expect(can('account_director', 'manage_accounts')).toBe(false)
  })

  it('restricts sync triggering the same way', () => {
    expect(can('agency_admin', 'trigger_sync')).toBe(true)
    expect(can('account_director', 'trigger_sync')).toBe(false)
  })

  it('grants agency_admin manage_users, bounded by scope rather than capability', () => {
    // §5.3 marks this cell "scope only". It is expressed as capability plus
    // scope: agency_admin holds the capability, and the scope resolver already
    // confines every action to their agency. A separate "scope only" state
    // would duplicate a restriction the middleware applies regardless.
    expect(can('agency_admin', 'manage_users')).toBe(true)
    expect(can('account_director', 'manage_users')).toBe(false)
  })

  it('grants super_admin every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(can('super_admin', capability)).toBe(true)
    }
  })
})
