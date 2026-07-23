import type { AppDb } from '@zoo/db'
import { authAccounts, authSessions, memberships, networks, users } from '@zoo/db/schema'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createAuth, type Auth } from './auth'
import { seedBreakGlassAdmin } from './seed-admin'

/**
 * better-auth integration — SPEC.md §5, §16 #4.
 *
 * Runs the real better-auth instance against real Postgres, so what is proven
 * is the wiring itself: that the credential the seed writes can actually sign
 * in, that the domain restriction blocks a session, and that the mapping onto
 * the §4.3 users table works rather than quietly creating a second identity
 * table.
 */

const env = testServerEnv()

let db: AppDb
let auth: Auth

beforeAll(async () => {
  db = await createTestDb()
  auth = createAuth(db, env, env.WEB_ORIGIN)

  await db.insert(networks).values({ name: 'Zoo Media', slug: 'zoo-media' })
}, 60_000)

describe('break-glass admin seed (§16 #4)', () => {
  it('creates the user, credential and super_admin membership', async () => {
    const result = await seedBreakGlassAdmin(db, auth, {
      email: env.SUPERADMIN_EMAIL,
      password: env.SUPERADMIN_PASSWORD,
    })

    expect(result.created).toBe(true)
    expect(result.membershipGranted).toBe(true)

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, result.userId))

    expect(membership!.role).toBe('super_admin')
    expect(membership!.scopeType).toBe('network')
  })

  it('writes identity into the §4.3 users table, not a second one', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, env.SUPERADMIN_EMAIL))

    expect(user).toBeDefined()
    expect(user!.name).toBe('Break-glass Admin')
  })

  it('never stores the password in plaintext', async () => {
    const authContext = await auth.$context
    const [user] = await db.select().from(users).where(eq(users.email, env.SUPERADMIN_EMAIL))
    const accounts = await authContext.internalAdapter.findAccountByUserId(user!.id)
    const credential = accounts.find((account) => account.providerId === 'credential')

    expect(credential?.password).toBeDefined()
    expect(credential?.password).not.toContain(env.SUPERADMIN_PASSWORD)
  })

  it('is idempotent and does not duplicate the membership', async () => {
    const again = await seedBreakGlassAdmin(db, auth, {
      email: env.SUPERADMIN_EMAIL,
      password: env.SUPERADMIN_PASSWORD,
    })

    expect(again.created).toBe(false)
    expect(again.membershipGranted).toBe(false)

    const rows = await db.select().from(memberships).where(eq(memberships.userId, again.userId))

    expect(rows).toHaveLength(1)
  })

  it('repairs a downgraded break-glass role rather than leaving it useless', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, env.SUPERADMIN_EMAIL))
    await db.update(memberships).set({ role: 'viewer' }).where(eq(memberships.userId, user!.id))

    const repaired = await seedBreakGlassAdmin(db, auth, {
      email: env.SUPERADMIN_EMAIL,
      password: env.SUPERADMIN_PASSWORD,
    })

    expect(repaired.membershipGranted).toBe(true)

    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user!.id))

    expect(membership!.role).toBe('super_admin')
  })
})

describe('break-glass sign-in actually works', () => {
  it('issues a session for the seeded credentials', async () => {
    // The point of a break-glass account is that it works when SSO does not.
    // Asserting the row exists is not enough; this signs in for real.
    const result = await auth.api.signInEmail({
      body: { email: env.SUPERADMIN_EMAIL, password: env.SUPERADMIN_PASSWORD },
    })

    expect(result.user.email).toBe(env.SUPERADMIN_EMAIL)
    expect(result.token).toBeTruthy()
  })

  it('rejects the wrong password', async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: env.SUPERADMIN_EMAIL, password: 'not-the-password' },
      }),
    ).rejects.toThrow()
  })

  it('records the sign-in on the user row for the audit trail (§12)', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, env.SUPERADMIN_EMAIL))

    expect(user!.lastLoginAt).not.toBeNull()
  })
})

describe('no open registration (§16 #4)', () => {
  it('refuses credential sign-up even on the allowed domain', async () => {
    // disableSignUp closes the path entirely — users exist only by invite or
    // an explicit membership grant.
    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'newcomer@thestarterlabs.com',
          password: 'a-perfectly-fine-password',
          name: 'Newcomer',
        },
      }),
    ).rejects.toThrow()
  })

  it('leaves no user row behind after a refused sign-up', async () => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'newcomer@thestarterlabs.com'))

    expect(user).toBeUndefined()
  })
})

/**
 * The allowlist is the whole domain wall — the Google consent screen is
 * External, so any Google account (gmail.com included) can complete the OAuth
 * handshake and arrive with a valid, verified identity.
 */
describe('domain allowlist — gate 1, account creation', () => {
  const createUser = async (email: string) => {
    const authContext = await auth.$context

    return authContext.internalAdapter.createUser({ email, name: 'Probe', emailVerified: true })
  }

  it('admits a thestarterlabs.com address', async () => {
    const user = await createUser('person@thestarterlabs.com')

    expect(user.email).toBe('person@thestarterlabs.com')
  })

  it('admits a zoomedia.com address', async () => {
    const user = await createUser('person@zoomedia.com')

    expect(user.email).toBe('person@zoomedia.com')
  })

  it('REJECTS a gmail.com address', async () => {
    await expect(createUser('attacker@gmail.com')).rejects.toThrow(/restricted to/)
  })

  it('rejects every other off-list domain', async () => {
    for (const email of [
      'attacker@outlook.com',
      'attacker@notthestarterlabs.com',
      'attacker@evil.zoomedia.com',
      'attacker@zoomedia.com.evil.net',
    ]) {
      await expect(createUser(email)).rejects.toThrow(/restricted to/)
    }
  })

  it('leaves no user row behind for any rejected address', async () => {
    for (const email of [
      'attacker@gmail.com',
      'attacker@outlook.com',
      'attacker@notthestarterlabs.com',
      'attacker@evil.zoomedia.com',
      'attacker@zoomedia.com.evil.net',
    ]) {
      const [user] = await db.select().from(users).where(eq(users.email, email))

      expect(user, `${email} should not exist`).toBeUndefined()
    }
  })

  it('names the allowlist in the rejection, without leaking anything else', async () => {
    await expect(createUser('attacker@gmail.com')).rejects.toThrow(
      /@thestarterlabs\.com, @zoomedia\.com/,
    )
  })
})

describe('domain allowlist — gate 2, session creation', () => {
  const PASSWORD = 'a-perfectly-fine-password'

  /**
   * Inserts a user and credential with raw SQL, bypassing gate 1 on purpose.
   *
   * This is the row shape you get from a user created before the allowlist
   * changed, or by any path that skipped user creation. Gate 1 fires once,
   * ever; without gate 2 such a user would keep signing in forever.
   */
  async function seedBypassingGate1(email: string) {
    const authContext = await auth.$context

    const [user] = await db
      .insert(users)
      .values({ email, name: 'Legacy', emailVerified: true })
      .returning()

    await db.insert(authAccounts).values({
      userId: user!.id,
      providerId: 'credential',
      accountId: user!.id,
      password: await authContext.password.hash(PASSWORD),
    })

    return user!.id
  }

  it('admits a legacy thestarterlabs.com user', async () => {
    await seedBypassingGate1('legacy@thestarterlabs.com')

    const result = await auth.api.signInEmail({
      body: { email: 'legacy@thestarterlabs.com', password: PASSWORD },
    })

    expect(result.token).toBeTruthy()
  })

  it('admits a legacy zoomedia.com user', async () => {
    await seedBypassingGate1('legacy@zoomedia.com')

    const result = await auth.api.signInEmail({
      body: { email: 'legacy@zoomedia.com', password: PASSWORD },
    })

    expect(result.token).toBeTruthy()
  })

  it('REJECTS a legacy gmail.com user that already has a valid credential', async () => {
    await seedBypassingGate1('legacy@gmail.com')

    await expect(
      auth.api.signInEmail({ body: { email: 'legacy@gmail.com', password: PASSWORD } }),
    ).rejects.toThrow(/restricted to/)
  })

  it('rejects other legacy off-list users the same way', async () => {
    for (const email of ['legacy@outlook.com', 'legacy@notthestarterlabs.com']) {
      await seedBypassingGate1(email)

      await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toThrow(
        /restricted to/,
      )
    }
  })

  it('issues no session row for any refused sign-in', async () => {
    for (const email of [
      'legacy@gmail.com',
      'legacy@outlook.com',
      'legacy@notthestarterlabs.com',
    ]) {
      const [user] = await db.select().from(users).where(eq(users.email, email))
      const sessions = await db.select().from(authSessions).where(eq(authSessions.userId, user!.id))

      expect(sessions, `${email} should hold no session`).toEqual([])
    }
  })

  it('refuses to issue a session to a deactivated user', async () => {
    // is_active is the off switch that must not require deleting the audit trail.
    const authContext = await auth.$context
    const suspended = await authContext.internalAdapter.createUser({
      email: 'suspended@thestarterlabs.com',
      name: 'Suspended',
      emailVerified: true,
    })
    await authContext.internalAdapter.linkAccount({
      userId: suspended.id,
      providerId: 'credential',
      accountId: suspended.id,
      password: await authContext.password.hash('a-perfectly-fine-password'),
    })
    await db.update(users).set({ isActive: false }).where(eq(users.id, suspended.id))

    await expect(
      auth.api.signInEmail({
        body: { email: 'suspended@thestarterlabs.com', password: 'a-perfectly-fine-password' },
      }),
    ).rejects.toThrow()
  })
})

describe('google is configured as a sign-in path', () => {
  it('exposes a Google authorization url', async () => {
    const result = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: env.WEB_ORIGIN[0] },
    })

    expect(result.url).toContain('accounts.google.com')
  })
})
