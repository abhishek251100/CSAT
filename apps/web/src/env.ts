import { z } from 'zod'

/**
 * Client env contract (SPEC.md §12).
 *
 * Vite inlines only `VITE_`-prefixed vars into the bundle, so everything here
 * is public by definition. Never add a secret to this schema — API keys,
 * database URLs, and AI provider keys stay server-side (§11).
 *
 * Validated at module load so a misconfigured build fails at startup with a
 * readable message rather than as a confusing runtime fetch error.
 */
/**
 * Default API origin: the empty string — same-origin relative URLs (`/api/...`),
 * the single-domain deploy. This is deliberately NOT keyed off
 * `import.meta.env.PROD`: a build with `NODE_ENV=development` in the environment
 * (e.g. a stray Vercel env var) flips `PROD` to false, which would silently bake
 * `http://localhost:8787` into the production bundle. Local dev instead sets
 * `VITE_API_URL=http://localhost:8787` explicitly in `.env` (see `.env.example`),
 * which overrides this default; a split-origin deploy sets it to a full origin.
 */
const defaultApiUrl = ''

const clientEnvSchema = z.object({
  /**
   * Base origin of the API. Two shapes are valid:
   *   - a full origin ('http://localhost:8787') for a split-origin deploy or
   *     local dev, where the web dev server and API run on different ports;
   *   - the empty string for a single-domain deploy (Vercel), where the API is
   *     same-origin under /api and the browser should use relative URLs.
   * Never a path — the app appends '/api/...' itself.
   */
  VITE_API_URL: z
    .union([z.literal(''), z.url()])
    .default(defaultApiUrl)
    .refine((value) => !value.endsWith('/'), 'VITE_API_URL must not end with a slash'),
})

function parseClientEnv() {
  const result = clientEnvSchema.safeParse(import.meta.env)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(`Invalid client environment:\n${details}`)
  }

  return result.data
}

export const env = parseClientEnv()
