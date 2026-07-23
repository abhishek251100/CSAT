import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { createdAt, primaryId, updatedAt } from './_shared'

/**
 * Credential tables owned by better-auth — SPEC.md §4.3 ("auth credential
 * tables owned by better-auth").
 *
 * Shapes are transcribed from what better-auth 1.6.23 actually requires, read
 * out of the library at build time rather than from documentation. If
 * better-auth is upgraded, re-check its schema before migrating.
 *
 * Two deliberate departures from better-auth's defaults:
 *
 *  1. Table names are prefixed `auth_`. better-auth calls its credential model
 *     `account`, which would collide head-on with the `accounts` table in §4.3
 *     — an entirely different concept (a client brand). The prefix is applied
 *     via `modelName` in the better-auth config; nothing else changes.
 *
 *  2. There is no better-auth `user` table. §4.3 owns identity in `users`, and
 *     duplicating it would create two answers to "who is this person". The
 *     better-auth `user` model is mapped onto `users` instead, which is why
 *     that table carries `email_verified` and a NOT NULL `name`.
 *
 * These tables are not given the updated_at trigger from migration 0001:
 * better-auth writes `updated_at` itself on every mutation, and a trigger would
 * be redundant interference in rows the ORM never touches directly.
 */

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Opaque session token carried in the cookie. */
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('auth_sessions_user_id_idx').on(table.userId)],
)

/**
 * One row per linked credential: a Google identity, or the hashed password of
 * the break-glass super_admin.
 */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Provider-side id — the Google `sub`, or the user id for credentials. */
    accountId: text('account_id').notNull(),
    /** 'google' or 'credential'. */
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** Hashed by better-auth. Null for social logins. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('auth_accounts_user_id_idx').on(table.userId),
    index('auth_accounts_provider_idx').on(table.providerId, table.accountId),
  ],
)

/** Short-lived tokens for email verification and password reset flows. */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: primaryId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
)
