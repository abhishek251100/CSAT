/**
 * Sign-in admission policy — SPEC.md §16 #4.
 *
 * Google Workspace SSO is the only interactive sign-in path, restricted to an
 * allowlist of email domains, plus one break-glass super_admin on email and
 * password.
 *
 * This is the entire domain wall. The Google OAuth consent screen is
 * configured as External, so *any* Google account — personal gmail.com
 * included — can reach consent and complete the OAuth handshake. Google will
 * hand back a valid, verified identity for all of them. Nothing upstream
 * filters by organisation, which means every rejection happens here.
 *
 * Consequently this module is pure and separated from better-auth so the rule
 * can be tested exhaustively. The failure modes are quiet ones: suffix
 * matching, subdomains, case, a local part impersonating a domain, and a
 * permissive parse silently widening the allowlist.
 */

export interface SignInPolicy {
  /** Lowercased bare domains. Membership is exact — never a suffix match. */
  readonly allowedDomains: ReadonlySet<string>
  /** The one address exempt from the domain rule. */
  readonly breakGlassEmail: string
}

/**
 * A bare DNS domain: two or more labels, each alphanumeric with internal
 * hyphens only.
 *
 * Deliberately ASCII-only. Rejecting non-ASCII rules out IDN homograph
 * lookalikes (e.g. Cyrillic 'о' in "zоomedia.com") that would be visually
 * indistinguishable in a .env file. If a genuinely internationalised domain is
 * ever needed, add it in punycode form rather than relaxing this.
 *
 * Also rejects, by construction: '@domain.com', 'https://domain.com',
 * 'domain.com.', 'domain.com/path', bare 'localhost', and anything with spaces.
 */
const BARE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export class DomainListError extends Error {}

/**
 * Parses ALLOWED_EMAIL_DOMAINS into a normalised, deduplicated, sorted list.
 *
 * Strict on purpose: a malformed entry throws rather than being skipped.
 * Silently dropping a bad entry would shrink the allowlist without warning and
 * lock people out; silently accepting one could widen it. Both are worse than
 * refusing to boot.
 */
export function parseDomainList(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    throw new DomainListError(
      'ALLOWED_EMAIL_DOMAINS is empty. At least one domain is required — an empty ' +
        'allowlist would admit nobody, and the Google consent screen is External so ' +
        'this list is the only thing restricting sign-in.',
    )
  }

  const invalid = entries.filter((entry) => !BARE_DOMAIN.test(entry))

  if (invalid.length > 0) {
    throw new DomainListError(
      `ALLOWED_EMAIL_DOMAINS contains invalid entries: ${invalid.join(', ')}. ` +
        'Use bare comma-separated domains such as thestarterlabs.com,zoomedia.com ' +
        '(no @, no scheme, no path, no trailing dot, ASCII only).',
    )
  }

  return [...new Set(entries)].sort()
}

/**
 * The domain portion of an address, lowercased, or null if there isn't one.
 *
 * Splits on the LAST '@'. A quoted local part may legally contain one, and
 * splitting on the first would produce a domain like
 * 'evil.com@thestarterlabs.com' that fails to compare correctly.
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at === -1) return null

  const domain = email.slice(at + 1).toLowerCase()

  return domain.length === 0 ? null : domain
}

/**
 * May this address sign in at all?
 *
 * Note what this does NOT decide: it grants admission, not authority. A user on
 * an allowed domain with no membership row still resolves to an empty account
 * set and sees nothing (§5.2 is closed by default). Domain match is the outer
 * gate; `memberships` is the inner one.
 *
 * Membership is exact set lookup, never `endsWith`. A suffix check would admit
 * `notthestarterlabs.com`, and allowing subdomains would admit any host an
 * attacker can register beneath one.
 */
export function isSignInAllowed(email: string, policy: SignInPolicy): boolean {
  const normalised = email.trim().toLowerCase()

  if (normalised === policy.breakGlassEmail.trim().toLowerCase()) return true

  /**
   * Require a non-empty local part. '@zoomedia.com' carries an allowlisted
   * domain but names no one, so a domain-only check would admit it. Google will
   * never send such an address, but this gate is the whole wall — it should not
   * depend on the caller being well behaved.
   */
  if (normalised.lastIndexOf('@') <= 0) return false

  const domain = emailDomain(normalised)

  return domain !== null && policy.allowedDomains.has(domain)
}

/** Human-readable allowlist for error messages. */
export function describeAllowedDomains(policy: SignInPolicy): string {
  return [...policy.allowedDomains].map((domain) => `@${domain}`).join(', ')
}
