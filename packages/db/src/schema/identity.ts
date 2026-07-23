import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { createdAt, primaryId, roleKeyEnum, scopeTypeEnum, updatedAt } from './_shared'

/**
 * Identity and RBAC — SPEC.md §4.3.
 *
 * This is the application's view of a user, and also the table better-auth's
 * `user` model is mapped onto (see schema/auth.ts). §4.3 gives the credential
 * tables to better-auth but keeps identity here, so there is one answer to "who
 * is this person" rather than a better-auth user row shadowing an app user row.
 *
 * Three columns exist to satisfy that mapping:
 *   - `name` is NOT NULL because better-auth requires it. Google always
 *     supplies one, and the break-glass admin is seeded with one.
 *   - `email_verified` is better-auth's field, kept under its own name.
 *   - `avatar_url` backs better-auth's `image` field via a field mapping.
 */
export const users = pgTable('users', {
  id: primaryId(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  emailVerified: boolean('email_verified').notNull().default(false),
  /**
   * Deactivating a user must end their access without deleting the audit trail
   * that points at them. Checked when a session is created (see auth.ts), so a
   * deactivated user cannot sign in even with valid Google credentials.
   */
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * The single table that drives all visibility (§4.3, §5.2).
 *
 * A `network` membership sees every account in that network; an `agency`
 * membership sees that agency's accounts; an `account` membership sees just
 * those accounts. `resolveVisibleAccounts(userId)` (Milestone 3) resolves this
 * to an id set, and every list and aggregate query filters by it.
 *
 * `scope_id` is a soft FK — validated in the application, not by the database —
 * because it points at one of three different tables depending on `scope_type`.
 * §4.3 calls this out. The trade-off is deliberate: the alternative is three
 * nullable FK columns plus a CHECK, which complicates every read of this table
 * for integrity the app already enforces on write.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopeType: scopeTypeEnum('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    role: roleKeyEnum('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One role per user per scope. Re-granting updates rather than stacking.
    unique('memberships_user_scope_key').on(table.userId, table.scopeType, table.scopeId),
    index('memberships_user_id_idx').on(table.userId),
    index('memberships_scope_idx').on(table.scopeType, table.scopeId),
  ],
)
