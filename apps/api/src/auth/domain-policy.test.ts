import { describe, expect, it } from 'vitest'
import {
  describeAllowedDomains,
  emailDomain,
  isSignInAllowed,
  parseDomainList,
  type SignInPolicy,
} from './domain-policy'

/**
 * The Google consent screen is External, so any Google account can complete the
 * OAuth handshake and arrive here with a valid identity. This allowlist is the
 * only thing that turns them away, which is why these tests are exhaustive.
 */
const policy: SignInPolicy = {
  allowedDomains: new Set(['thestarterlabs.com', 'zoomedia.com']),
  breakGlassEmail: 'breakglass@offlist.example',
}

describe('parseDomainList — normalisation', () => {
  it('parses a comma-separated list', () => {
    expect(parseDomainList('thestarterlabs.com,zoomedia.com')).toEqual([
      'thestarterlabs.com',
      'zoomedia.com',
    ])
  })

  it('trims whitespace around entries', () => {
    expect(parseDomainList(' thestarterlabs.com , zoomedia.com ')).toEqual([
      'thestarterlabs.com',
      'zoomedia.com',
    ])
  })

  it('lowercases, since domains are case-insensitive', () => {
    expect(parseDomainList('TheStarterLabs.COM,ZooMedia.Com')).toEqual([
      'thestarterlabs.com',
      'zoomedia.com',
    ])
  })

  it('drops empty entries from stray commas', () => {
    expect(parseDomainList('thestarterlabs.com,,zoomedia.com,')).toEqual([
      'thestarterlabs.com',
      'zoomedia.com',
    ])
  })

  it('deduplicates', () => {
    expect(parseDomainList('zoomedia.com,ZOOMEDIA.COM,zoomedia.com')).toEqual(['zoomedia.com'])
  })

  it('accepts a single domain', () => {
    expect(parseDomainList('thestarterlabs.com')).toEqual(['thestarterlabs.com'])
  })

  it('accepts subdomain-style and hyphenated domains', () => {
    expect(parseDomainList('mail.zoo-media.co.uk')).toEqual(['mail.zoo-media.co.uk'])
  })
})

describe('parseDomainList — fails fast rather than silently widening or narrowing', () => {
  it('rejects an empty string', () => {
    expect(() => parseDomainList('')).toThrow(/empty/i)
  })

  it('rejects a list of nothing but separators', () => {
    expect(() => parseDomainList(',,, ,')).toThrow(/empty/i)
  })

  it('rejects an entry written as @domain', () => {
    expect(() => parseDomainList('@thestarterlabs.com')).toThrow(/invalid entries/i)
  })

  it('rejects a url', () => {
    expect(() => parseDomainList('https://thestarterlabs.com')).toThrow(/invalid entries/i)
    expect(() => parseDomainList('thestarterlabs.com/path')).toThrow(/invalid entries/i)
  })

  it('rejects a trailing dot', () => {
    expect(() => parseDomainList('thestarterlabs.com.')).toThrow(/invalid entries/i)
  })

  it('rejects a single label with no dot', () => {
    expect(() => parseDomainList('localhost')).toThrow(/invalid entries/i)
  })

  it('rejects a whole email address', () => {
    expect(() => parseDomainList('person@thestarterlabs.com')).toThrow(/invalid entries/i)
  })

  it('rejects wildcards, which would be read as a suffix rule', () => {
    expect(() => parseDomainList('*.thestarterlabs.com')).toThrow(/invalid entries/i)
  })

  it('rejects non-ASCII lookalike domains', () => {
    // 'zоomedia.com' with a Cyrillic 'о' is a different registration that looks
    // identical in a .env file.
    expect(() => parseDomainList('zоomedia.com')).toThrow(/invalid entries/i)
  })

  it('rejects the whole list when one entry is bad, rather than skipping it', () => {
    // Skipping would quietly shrink the allowlist and lock people out.
    expect(() => parseDomainList('thestarterlabs.com,@bad,zoomedia.com')).toThrow(
      /invalid entries/i,
    )
  })
})

describe('emailDomain', () => {
  it('takes the part after the final @', () => {
    expect(emailDomain('person@thestarterlabs.com')).toBe('thestarterlabs.com')
  })

  it('lowercases', () => {
    expect(emailDomain('Person@TheStarterLabs.COM')).toBe('thestarterlabs.com')
  })

  it('splits on the last @, not the first', () => {
    expect(emailDomain('"weird@local"@zoomedia.com')).toBe('zoomedia.com')
  })

  it('returns null with no @ or an empty domain', () => {
    expect(emailDomain('not-an-email')).toBeNull()
    expect(emailDomain('trailing@')).toBeNull()
  })
})

describe('isSignInAllowed — every allowlisted domain is admitted', () => {
  it('admits thestarterlabs.com', () => {
    expect(isSignInAllowed('person@thestarterlabs.com', policy)).toBe(true)
  })

  it('admits zoomedia.com', () => {
    expect(isSignInAllowed('person@zoomedia.com', policy)).toBe(true)
  })

  it('admits regardless of case', () => {
    expect(isSignInAllowed('Person@ZooMedia.COM', policy)).toBe(true)
  })

  it('admits regardless of surrounding whitespace', () => {
    expect(isSignInAllowed('  person@zoomedia.com  ', policy)).toBe(true)
  })
})

describe('isSignInAllowed — everything off the list is rejected', () => {
  it('rejects gmail.com', () => {
    // The case External consent makes reachable: any personal Google account
    // can complete OAuth and arrive here.
    expect(isSignInAllowed('attacker@gmail.com', policy)).toBe(false)
  })

  it('rejects other common consumer providers', () => {
    for (const domain of ['outlook.com', 'yahoo.com', 'proton.me', 'googlemail.com']) {
      expect(isSignInAllowed(`attacker@${domain}`, policy)).toBe(false)
    }
  })

  it('rejects a subdomain of an allowed domain', () => {
    // evil.zoomedia.com is a different name and may be attacker-controlled.
    expect(isSignInAllowed('person@evil.zoomedia.com', policy)).toBe(false)
    expect(isSignInAllowed('person@mail.thestarterlabs.com', policy)).toBe(false)
  })

  it('rejects a parent of an allowed domain', () => {
    expect(isSignInAllowed('person@com', policy)).toBe(false)
  })

  it('rejects a domain that merely ends with an allowed one', () => {
    // The classic suffix-match hole — an unrelated registration.
    expect(isSignInAllowed('attacker@notthestarterlabs.com', policy)).toBe(false)
    expect(isSignInAllowed('attacker@fakezoomedia.com', policy)).toBe(false)
  })

  it('rejects a domain that an allowed one is a suffix of, reversed', () => {
    expect(isSignInAllowed('attacker@zoomedia.com.evil.net', policy)).toBe(false)
  })

  it('rejects an allowed domain appearing in the local part', () => {
    expect(isSignInAllowed('thestarterlabs.com@gmail.com', policy)).toBe(false)
    expect(isSignInAllowed('person@zoomedia.com@gmail.com', policy)).toBe(false)
  })

  it('rejects a malformed address outright', () => {
    expect(isSignInAllowed('not-an-email', policy)).toBe(false)
    expect(isSignInAllowed('', policy)).toBe(false)
  })

  it('rejects an address with an allowlisted domain but no local part', () => {
    // '@zoomedia.com' carries an allowed domain but names nobody. A
    // domain-only check would admit it.
    expect(isSignInAllowed('@zoomedia.com', policy)).toBe(false)
    expect(isSignInAllowed('  @thestarterlabs.com', policy)).toBe(false)
  })

  it('rejects a trailing-dot form of an allowed domain', () => {
    expect(isSignInAllowed('person@zoomedia.com.', policy)).toBe(false)
  })
})

describe('isSignInAllowed — break-glass exemption', () => {
  it('admits the break-glass address even though it is off-list', () => {
    expect(isSignInAllowed('breakglass@offlist.example', policy)).toBe(true)
  })

  it('matches it case-insensitively', () => {
    expect(isSignInAllowed('BreakGlass@OffList.Example', policy)).toBe(true)
  })

  it('exempts only that exact address, not its whole domain', () => {
    // Otherwise seeding one off-list admin would silently admit everyone
    // sharing its domain.
    expect(isSignInAllowed('someone-else@offlist.example', policy)).toBe(false)
  })
})

describe('describeAllowedDomains', () => {
  it('renders the allowlist for error messages', () => {
    expect(describeAllowedDomains(policy)).toBe('@thestarterlabs.com, @zoomedia.com')
  })
})
