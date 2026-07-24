import { router } from '../trpc'
import { authRouter } from './auth'
import { healthRouter } from './health'
import { orgRouter } from './org'
import { actionsRouter } from './actions'
import { dsatRouter } from './dsat'
import { escalationsRouter } from './escalations'
import { metricsRouter } from './metrics'
import { rcaRouter } from './rca'
import { responsesRouter } from './responses'
import { usersRouter } from './users'

/**
 * The tRPC root router (SPEC.md §8).
 *
 * apps/web imports only the `AppRouter` *type* from this module, which erases
 * at build time — no server code reaches the browser bundle.
 */
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  org: orgRouter,
  users: usersRouter,
  metrics: metricsRouter,
  dsat: dsatRouter,
  escalations: escalationsRouter,
  rca: rcaRouter,
  actions: actionsRouter,
  responses: responsesRouter,
})

export type AppRouter = typeof appRouter
