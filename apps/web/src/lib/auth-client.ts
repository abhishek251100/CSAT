import { createAuthClient } from 'better-auth/react'
import { env } from '../env'

/**
 * better-auth browser client.
 *
 * Talks to the API's /api/auth routes, not to the Vite dev server. The session
 * lives in an httpOnly cookie the browser sends automatically, which is why the
 * API sets `credentials: true` on CORS.
 *
 * Note what is absent: no sign-up. §16 #4 allows exactly two ways in — Google
 * Workspace SSO on the allowed domain, and the seeded break-glass admin — and
 * neither involves self-registration.
 */
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
})

export const { useSession, signIn, signOut } = authClient
