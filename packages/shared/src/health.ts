import { z } from 'zod'

/**
 * The Milestone 1 end-to-end type-flow proof.
 *
 * These schemas are defined once here and consumed in three places:
 *   1. apps/api  — as the tRPC procedure's `.input()` / `.output()` validators
 *   2. apps/web  — the inferred types arrive on the client via the AppRouter type
 *   3. tests     — parsed directly
 *
 * If this file changes, the web app fails to typecheck. That is the property
 * Milestone 1 exists to demonstrate.
 */
export const pingInputSchema = z.object({
  /** Free-text label echoed back by the server, to prove payloads round-trip. */
  name: z.string().min(1).max(64),
})

export type PingInput = z.infer<typeof pingInputSchema>

export const pingOutputSchema = z.object({
  message: z.string(),
  /** ISO-8601, UTC. SPEC.md §12: UTC in transit, localised in the UI. */
  receivedAt: z.iso.datetime(),
  apiVersion: z.string(),
})

export type PingOutput = z.infer<typeof pingOutputSchema>
