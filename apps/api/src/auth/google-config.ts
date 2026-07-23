/**
 * Google provider configuration — SPEC.md §16 #4.
 *
 * Deliberately NOT a boot-blocking env check.
 *
 * The break-glass admin exists precisely for when Google sign-in is
 * unavailable. Refusing to start the API because the OAuth client id is wrong
 * would mean a broken SSO configuration also destroys the only way back in —
 * the exact failure the break-glass account is there to survive.
 *
 * So a malformed or missing Google config degrades the Google button and
 * nothing else: the server starts, break-glass works, and the problem is
 * reported loudly at boot, on the API root banner, and to anyone who clicks
 * "Continue with Google".
 *
 * Everything else in the env contract stays fail-fast (§12) — DATABASE_URL and
 * BETTER_AUTH_SECRET have no working degraded mode.
 */

export type GoogleConfig =
  | { readonly enabled: true; readonly clientId: string; readonly clientSecret: string }
  | { readonly enabled: false; readonly problem: string }

/**
 * A full OAuth 2.0 client id: `<project-number>-<random>.apps.googleusercontent.com`.
 *
 * The bare project number is shown prominently in Google Cloud Console and is
 * the single most common thing pasted here by mistake. Google's own response to
 * it — "401 invalid_client" on a redirect page — points nowhere near the .env
 * file, so it is worth naming precisely.
 */
const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

export function resolveGoogleConfig(
  clientId: string | undefined,
  clientSecret: string | undefined,
): GoogleConfig {
  const id = clientId?.trim() ?? ''
  const secret = clientSecret?.trim() ?? ''

  if (id === '' && secret === '') {
    return {
      enabled: false,
      problem: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.',
    }
  }

  if (id === '') return { enabled: false, problem: 'GOOGLE_CLIENT_ID is not set.' }
  if (secret === '') return { enabled: false, problem: 'GOOGLE_CLIENT_SECRET is not set.' }

  if (!id.endsWith(CLIENT_ID_SUFFIX)) {
    return {
      enabled: false,
      problem:
        `GOOGLE_CLIENT_ID is "${id}", which is not an OAuth client id — it must end in ` +
        `${CLIENT_ID_SUFFIX} (like 123456789012-abc...xyz${CLIENT_ID_SUFFIX}). ` +
        'A bare project number is not the client id; copy it from ' +
        'APIs & Services > Credentials > OAuth 2.0 Client IDs.',
    }
  }

  return { enabled: true, clientId: id, clientSecret: secret }
}

/** The banner printed at boot when Google sign-in is unavailable. */
export function googleDisabledWarning(problem: string, callbackUrl: string): string {
  return [
    '',
    '  ┌─────────────────────────────────────────────────────────────────────┐',
    '  │  Google sign-in is DISABLED                                         │',
    '  └─────────────────────────────────────────────────────────────────────┘',
    `  ${problem}`,
    '',
    '  The API is running and break-glass sign-in still works, so you are not',
    '  locked out. Fix the value in .env and restart to re-enable Google.',
    `  Redirect URI to register: ${callbackUrl}`,
    '',
  ].join('\n')
}
