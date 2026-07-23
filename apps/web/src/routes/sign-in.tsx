import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { env } from '../env'
import { signIn } from '../lib/auth-client'

/**
 * A thrown error here almost always means the API is not reachable, which is
 * the one failure a user cannot diagnose from a generic message.
 */
function unreachableMessage(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)

  // Empty VITE_API_URL means the API is same-origin (single-domain deploy).
  const target = env.VITE_API_URL || window.location.origin
  return `Could not reach the API at ${target}. Is it running? (${detail})`
}

export const Route = createFileRoute('/sign-in')({
  component: SignIn,
})

/**
 * Minimal sign-in screen — SPEC.md §16 #4.
 *
 * Google Workspace SSO is the path everyone uses. The email and password form
 * exists solely for the seeded break-glass super_admin, so it is collapsed
 * behind a disclosure rather than presented as an equal option.
 *
 * There is deliberately no "create account" link: users exist only by invite or
 * an explicit membership grant.
 */
function SignIn() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showBreakGlass, setShowBreakGlass] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null)

  /**
   * When a Google sign-in is refused server-side — the commonest reason being
   * an off-domain account, which §16 #4's allowlist rejects — better-auth
   * redirects the browser back here with an `?error=` param rather than a
   * thrown error, because the rejection happens during the OAuth callback, not
   * the initial click. Without this the user would land on better-auth's bare
   * default error page. Reading the param turns it into a clear on-screen state.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    if (!oauthError) return

    /**
     * better-auth surfaces the databaseHook's rejection in the URL's `error`
     * param — and for a thrown APIError it carries the message itself, with
     * spaces as underscores (e.g. `Sign-in_is_restricted_to_...`). So the
     * domain rejection is recognised by its content rather than a fixed code,
     * which also covers the known error slugs. Anything else is generic.
     */
    const normalised = oauthError.replace(/_/g, ' ').toLowerCase()
    const isDomainRejection = /restricted|not on an allowed|domain[_ ]?not[_ ]?allowed/.test(
      normalised,
    )

    setError(
      isDomainRejection
        ? 'That account is not on an allowed domain. Sign in with your Zoo Media Google account.'
        : 'Google sign-in did not complete. Please try again.',
    )

    // Clear the param so a refresh does not re-show a stale message.
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  /**
   * Ask the API whether Google sign-in is actually configured.
   *
   * Without this the button looks available and fails only on click, which is
   * indistinguishable from "the app is broken". A null result means we could
   * not reach the API, and the button stays enabled so the click produces the
   * unreachable-API message rather than a misleading "not configured".
   */
  useEffect(() => {
    let cancelled = false

    fetch(`${env.VITE_API_URL}/api`)
      .then((response) => response.json())
      .then((banner: { signIn?: { google?: string } }) => {
        if (cancelled) return

        const enabled = banner.signIn?.google !== 'disabled'
        setGoogleEnabled(enabled)

        // If Google is off, break-glass is the ONLY way in — so open its form
        // by default rather than leaving it hidden behind a disclosure link.
        if (!enabled) setShowBreakGlass(true)
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Both handlers catch as well as checking the returned error.
   *
   * The auth client reports an expected rejection (wrong password, blocked
   * domain) on `result.error`, but a transport failure — API not running, CORS
   * refused, DNS — throws instead. Handling only the first leaves the button
   * disabled forever with nothing on screen, which reads as "the button is
   * broken" rather than "the server is unreachable". `finally` guarantees the
   * form becomes usable again whatever happened.
   */
  async function handleGoogle() {
    setError(null)
    setPending(true)

    try {
      const { error: signInError } = await signIn.social({
        provider: 'google',
        callbackURL: window.location.origin,
        // Where the browser lands if the callback is refused (e.g. off-domain).
        // better-auth appends its own ?error=<code>, mapped by the effect above.
        errorCallbackURL: `${window.location.origin}/sign-in`,
      })

      // On success the browser is redirected to Google, so reaching here with
      // no error means the redirect is in flight; leave `pending` set.
      if (signInError) {
        setError(signInError.message ?? 'Google sign-in failed.')
        setPending(false)
      }
    } catch (cause) {
      setError(unreachableMessage(cause))
      setPending(false)
    }
  }

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(event.currentTarget)

    try {
      const { error: signInError } = await signIn.email({
        /**
         * Trimmed: a trailing space survives a copy-paste and produces a bare
         * 401 that looks like a wrong password. The password is deliberately
         * NOT trimmed — whitespace can be a legitimate part of one.
         */
        email: String(form.get('email') ?? '').trim(),
        password: String(form.get('password') ?? ''),
      })

      if (signInError) {
        /**
         * A blocked domain is worth naming — the user can act on it. Anything
         * else stays deliberately vague so this cannot be used to discover
         * which addresses exist.
         */
        setError(
          signInError.status === 403
            ? (signInError.message ?? 'This account is not permitted to sign in.')
            : 'Sign-in failed. Check the address and password.',
        )
        return
      }

      await navigate({ to: '/' })
    } catch (cause) {
      setError(unreachableMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-50">Zoo Media CX</h1>
        <p className="text-sm text-slate-400">Sign in with your Zoo Media Google account.</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleGoogle}
        disabled={pending || googleEnabled === false}
        className="rounded-md bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue with Google
      </button>

      {googleEnabled === false && (
        <p className="-mt-4 rounded-md border border-amber-900 bg-amber-950/40 p-3 text-xs text-amber-300">
          Google sign-in is not configured on the server, so use the admin sign-in below. (To enable
          Google, set a real <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> in
          <code> .env</code> — see the API startup log for the exact problem.)
        </p>
      )}

      <div className="space-y-4 border-t border-slate-800 pt-6">
        {/* When Google is off this is the only way in, so it opens by default.
            Otherwise it stays a low-key disclosure. */}
        <button
          type="button"
          onClick={() => setShowBreakGlass((open) => !open)}
          aria-expanded={showBreakGlass}
          className={
            googleEnabled === false
              ? 'text-sm font-medium text-slate-200'
              : 'text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline'
          }
        >
          {googleEnabled === false ? 'Admin sign-in' : 'Break-glass admin sign-in'}
        </button>

        {showBreakGlass && (
          <form onSubmit={handleCredentials} className="space-y-3">
            <p className="text-xs text-slate-500">
              For platform administrators. Use the email and password from{' '}
              <code>SUPERADMIN_EMAIL</code> / <code>SUPERADMIN_PASSWORD</code> in your{' '}
              <code>.env</code>.
            </p>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Password</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className={
                googleEnabled === false
                  ? 'w-full rounded-md bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-white disabled:opacity-50'
                  : 'w-full rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-900 disabled:opacity-50'
              }
            >
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
