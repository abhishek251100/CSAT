import { router } from '../trpc'
import { authRouter } from './auth'
import { healthRouter } from './health'
import { orgRouter } from './org'
import { actionsRouter } from './actions'
import { escalationsRouter } from './escalations'
import { metricsRouter } from './metrics'
import { rcaRouter } from './rca'
import { responsesRouter } from './responses'

/**
 * The tRPC root router (SPEC.md §8).
 *
 * apps/web imports only the `AppRouter` *type* from this module, which erases
 * at build time — no server code reaches the browser bundle.
 *
 * Milestones 3+ mount the domain routers here: auth, org, users, metrics,
 * responses, escalations, rca, actions, sync, ai.
 */
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  org: orgRouter,
  metrics: metricsRouter,
  escalations: escalationsRouter,
  rca: rcaRouter,
  actions: actionsRouter,
  responses: responsesRouter,
})

export type AppRouter = typeof appRouter
