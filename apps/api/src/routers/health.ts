import { pingInputSchema, pingOutputSchema } from '@zoo/shared'
import { publicProcedure, router } from '../trpc'

/** Bumped by hand; surfaced so the client can detect a stale deployment. */
export const API_VERSION = '0.0.0'

/**
 * The Milestone 1 type-flow proof (SPEC.md §14.1).
 *
 * Both `.input()` and `.output()` are validated against schemas that live in
 * @zoo/shared, so the contract is declared once and enforced on the server
 * while flowing to the client purely as types.
 */
export const healthRouter = router({
  ping: publicProcedure
    .input(pingInputSchema)
    .output(pingOutputSchema)
    .query(({ input }) => ({
      message: `Hello, ${input.name} — the Zoo Media CX API is reachable.`,
      receivedAt: new Date().toISOString(),
      apiVersion: API_VERSION,
    })),
})
