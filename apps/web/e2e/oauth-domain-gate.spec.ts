import { expect, test, type Page } from '@playwright/test'

/**
 * OAuth domain gate, end to end — SPEC.md §16 #4.
 *
 * The automatable half of the External-OAuth security check. The consent screen
 * is External, so any Google account can complete the handshake; the allowlist
 * is the only wall. These tests drive a real browser through the real app and a
 * real OAuth callback, with only Google's endpoints stubbed:
 *
 *  - the server's token exchange is stubbed by the test API harness
 *    (e2e/support/oauth-test-server.mjs), which mints an id_token for whatever
 *    email is supplied as the authorization `code`
 *  - the browser's trip to the consent screen is stubbed below: the route
 *    handler catches the redirect to accounts.google.com and bounces straight
 *    back to the app's callback with `code=<email>`
 *
 * The domain gate itself runs entirely unmodified.
 */

const API = 'http://localhost:8799'

/**
 * Intercepts the consent-screen navigation and redirects to the app's callback,
 * standing in for a user who signs in at Google as `email`. The real `state`
 * from better-auth is preserved so its CSRF check passes.
 */
async function stubGoogleConsentAs(page: Page, email: string) {
  await page.route('https://accounts.google.com/o/oauth2/v2/auth**', async (route) => {
    const requested = new URL(route.request().url())
    const state = requested.searchParams.get('state') ?? ''
    const redirectUri =
      requested.searchParams.get('redirect_uri') ?? `${API}/api/auth/callback/google`

    // The harness's token mock reads the email out of `code`.
    const callback = `${redirectUri}?code=${encodeURIComponent(email)}&state=${encodeURIComponent(state)}`

    await route.fulfill({ status: 302, headers: { location: callback } })
  })
}

async function sessionState(page: Page, email: string) {
  const response = await page.request.get(
    `${API}/__test__/session-count?email=${encodeURIComponent(email)}`,
  )

  return response.json() as Promise<{ userExists: boolean; sessionCount: number }>
}

async function startGoogleSignIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByRole('button', { name: /continue with google/i }).click()
}

test.describe('off-domain identities are refused', () => {
  for (const email of ['attacker@gmail.com', 'someone@outlook.com']) {
    test(`${email} is rejected and gets no session`, async ({ page, context }) => {
      await stubGoogleConsentAs(page, email)
      await startGoogleSignIn(page)

      // Lands back on sign-in with the domain message, NOT on the dashboard.
      await expect(page).toHaveURL(/\/sign-in/)
      await expect(page.getByText(/not on an allowed domain/i)).toBeVisible()
      await expect(page.getByText(/Customer Satisfaction and Loyalty/i)).toHaveCount(0)

      // No session cookie in the browser.
      const cookies = await context.cookies()
      const sessionCookie = cookies.find((cookie) => /session/i.test(cookie.name))
      expect(sessionCookie, `no session cookie for ${email}`).toBeUndefined()

      // No session row on the server. (A user row may or may not exist depending
      // on which gate fired; what must never exist is a usable session.)
      const state = await sessionState(page, email)
      expect(state.sessionCount, `no session row for ${email}`).toBe(0)
    })
  }
})

test.describe('allowlisted identities are admitted', () => {
  for (const email of ['person@thestarterlabs.com', 'person@zoomedia.com']) {
    test(`${email} is admitted and reaches the dashboard`, async ({ page }) => {
      await stubGoogleConsentAs(page, email)
      await startGoogleSignIn(page)

      // Reaches the authenticated app, off the sign-in page.
      await expect(page).toHaveURL(`http://localhost:5199/`)
      await expect(page.getByText(/Customer Satisfaction and Loyalty/i)).toBeVisible({
        timeout: 15_000,
      })

      // A real session row exists for this user.
      const state = await sessionState(page, email)
      expect(state.userExists).toBe(true)
      expect(state.sessionCount).toBeGreaterThanOrEqual(1)
    })
  }
})
