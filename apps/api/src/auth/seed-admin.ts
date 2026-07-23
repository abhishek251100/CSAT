import type { AppDb } from '@zoo/db'
import { memberships, networks, users } from '@zoo/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Auth } from './auth'

/**
 * Seeds the break-glass super_admin — SPEC.md §16 #4.
 *
 * The one account that can sign in when Google SSO is unavailable. Credentials
 * come from env (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) and are never
 * hardcoded; the password is hashed by better-auth's own hasher so the stored
 * shape is exactly what its sign-in path expects.
 *
 * Idempotent, and deliberately conservative on re-run: an existing user's
 * password is left alone. Re-seeding is for repairing the *membership*, not for
 * silently rotating a credential someone may be relying on. Rotate by changing
 * the env var and passing `rotatePassword`.
 */
export interface SeedAdminResult {
  readonly userId: string
  readonly created: boolean
  readonly passwordRotated: boolean
  readonly membershipGranted: boolean
}

export async function seedBreakGlassAdmin(
  db: AppDb,
  auth: Auth,
  options: { email: string; password: string; name?: string; rotatePassword?: boolean },
): Promise<SeedAdminResult> {
  const email = options.email.toLowerCase()
  const authContext = await auth.$context

  const [network] = await db.select({ id: networks.id }).from(networks).limit(1)

  if (!network) {
    throw new Error('No network row found. Run the org seed first: pnpm --filter @zoo/db db:seed')
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  let userId: string
  let created = false
  let passwordRotated = false

  if (existing) {
    userId = existing.id

    if (options.rotatePassword) {
      const hash = await authContext.password.hash(options.password)
      await authContext.internalAdapter.updateAccount(
        (await authContext.internalAdapter.findAccountByUserId(userId)).find(
          (account) => account.providerId === 'credential',
        )!.id,
        { password: hash },
      )
      passwordRotated = true
    }
  } else {
    /**
     * Created through better-auth's internal adapter rather than a raw insert,
     * so the user row and the linked credential account are written exactly as
     * its sign-in path expects to read them.
     */
    const user = await authContext.internalAdapter.createUser({
      email,
      name: options.name ?? 'Break-glass Admin',
      emailVerified: true,
    })

    await authContext.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await authContext.password.hash(options.password),
    })

    userId = user.id
    created = true
  }

  /**
   * super_admin at network tier. §5.2 is closed by default, so without this the
   * account would authenticate and then see nothing — which is precisely the
   * failure you do not want from your emergency access path.
   */
  const [existingMembership] = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.scopeType, 'network'),
        eq(memberships.scopeId, network.id),
      ),
    )
    .limit(1)

  let membershipGranted = false

  if (!existingMembership) {
    await db.insert(memberships).values({
      userId,
      scopeType: 'network',
      scopeId: network.id,
      role: 'super_admin',
    })
    membershipGranted = true
  } else if (existingMembership.role !== 'super_admin') {
    // Repair a downgraded break-glass account rather than leaving it useless.
    await db
      .update(memberships)
      .set({ role: 'super_admin' })
      .where(eq(memberships.id, existingMembership.id))
    membershipGranted = true
  }

  return { userId, created, passwordRotated, membershipGranted }
}
