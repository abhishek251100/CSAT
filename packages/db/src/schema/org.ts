import { boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import {
  accountStatusEnum,
  createdAt,
  deletedAt,
  periodGrainEnum,
  primaryId,
  updatedAt,
} from './_shared'

/**
 * Structure and org — SPEC.md §4.3.
 *
 * The three-tier hierarchy from §1: Network (Zoo Media) -> Agency (TSL and
 * siblings) -> Account (the 16 brands). This chain is what
 * `resolveVisibleAccounts` walks in §5.2, so every level keeps an indexed FK to
 * its parent.
 *
 * ON DELETE RESTRICT throughout, per §4.1: an agency with accounts, or an
 * account with responses, cannot be deleted out from under its children.
 * Retirement is a soft delete via deleted_at.
 */

export const networks = pgTable('networks', {
  id: primaryId(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const agencies = pgTable(
  'agencies',
  {
    id: primaryId(),
    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * Marks a synthetic demo agency (`demo:seed`). The real network and the
     * real TSL agency are always `false`; only the second demo agency is true,
     * and `demo:purge` removes exactly the demo agencies. See the same column
     * on accounts, escalations, rcas and action_items.
     */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('agencies_network_id_idx').on(table.networkId),
    // ADDITION beyond §4.3: slugs address agencies in URLs, so they must be
    // unique within their network. Scoped rather than global so sibling
    // networks can reuse a slug later (§16 #8).
    unique('agencies_network_id_slug_key').on(table.networkId, table.slug),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    id: primaryId(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    industry: text('industry'),
    brandOwner: text('brand_owner'),

    /** §4.3 leaves this untyped; tightened to an enum by decision. */
    status: accountStatusEnum('status').notNull().default('active'),

    /**
     * Google continuity fields (§7.1). Most of the 16 accounts are Forms whose
     * response sheets must be located during sync setup; EPCH is a Sheet
     * directly, so it carries external_sheet_id with no form (§13).
     */
    externalFormUrl: text('external_form_url'),
    externalSheetId: text('external_sheet_id'),
    externalFormId: text('external_form_id'),

    /** CSAT is monthly and transactional; NPS quarterly and relational (§1). */
    csatCadence: periodGrainEnum('csat_cadence').notNull().default('monthly'),
    npsCadence: periodGrainEnum('nps_cadence').notNull().default('quarterly'),

    /** Marks a synthetic demo account. Real accounts are always false. */
    isDemo: boolean('is_demo').notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('accounts_agency_id_idx').on(table.agencyId),
    index('accounts_status_idx').on(table.status),
    unique('accounts_agency_id_slug_key').on(table.agencyId, table.slug),
  ],
)
