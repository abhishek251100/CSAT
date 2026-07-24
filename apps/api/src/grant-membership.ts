import { createDb, loadRootEnv } from '@zoo/db'
import { memberships, networks, users } from '@zoo/db/schema'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

loadRootEnv(import.meta.url)

const email = process.argv[2] ?? 'tech@thestarterlabs.com'
const role = (process.argv[3] ?? 'network_admin') as
  | 'super_admin'
  | 'network_admin'
  | 'agency_admin'
  | 'viewer'

const db = createDb(process.env.DATABASE_URL!)

const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
if (!user) {
  console.error(`[grant] No user with email ${email}. They must sign in once first.`)
  process.exit(1)
}

const [network] = await db.select().from(networks).where(eq(networks.slug, 'zoo-media')).limit(1)
if (!network) {
  console.error('[grant] Network zoo-media not found. Run: pnpm --filter @zoo/db db:seed')
  process.exit(1)
}

const existing = await db
  .select()
  .from(memberships)
  .where(
    and(
      eq(memberships.userId, user.id),
      eq(memberships.scopeType, 'network'),
      eq(memberships.scopeId, network.id),
    ),
  )

if (existing.length > 0) {
  console.log(`[grant] ${email} already has network membership as ${existing[0]!.role}`)
  process.exit(0)
}

await db.insert(memberships).values({
  id: uuidv7(),
  userId: user.id,
  scopeType: 'network',
  scopeId: network.id,
  role,
})

console.log(`[grant] Granted ${role} on network Zoo Media to ${email}`)
