import { describe, expect, it } from 'vitest'
import { parseFormId, SEED_ACCOUNTS, SEED_AGENCY, SEED_NETWORK } from './seed-data'

describe('seed data (§13)', () => {
  it('carries exactly the 16 accounts the spec lists', () => {
    expect(SEED_ACCOUNTS).toHaveLength(16)
  })

  it('names every account exactly as §13 spells it', () => {
    expect(SEED_ACCOUNTS.map((account) => account.name)).toEqual([
      'Mogu Mogu',
      'Chemistry',
      'Inkspired',
      'SOA',
      'The Croffle Guys',
      'Anemos',
      'Standard Chartered',
      'WhiteOak',
      'Alka Seltzer',
      'BuildWell',
      'Spunge',
      'EPCH',
      'AJ',
      'Ryan',
      'HyKr Venture Studio',
      'Sunteck',
    ])
  })

  it('has unique slugs, which the accounts_agency_id_slug_key constraint requires', () => {
    const slugs = SEED_ACCOUNTS.map((account) => account.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('uses url-safe kebab-case slugs', () => {
    for (const account of SEED_ACCOUNTS) {
      expect(account.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('seeds the network and agency named in §13', () => {
    expect(SEED_NETWORK.name).toBe('Zoo Media')
    expect(SEED_AGENCY.name).toBe('The Starter Labs')
  })
})

describe('EPCH is Sheet-backed (§13)', () => {
  const epch = SEED_ACCOUNTS.find((account) => account.slug === 'epch')

  it('carries the sheet id and no form url', () => {
    expect(epch?.externalSheetId).toBe('1m530xf7zHvKt9RIGBoHlaOKUfjNOxIugIdmHaxYpTaQ')
    expect(epch?.externalFormUrl).toBeNull()
  })

  it('yields no form id, since it has no form', () => {
    expect(parseFormId(epch?.externalFormUrl ?? null)).toBeNull()
  })

  it('is the only Sheet-backed account', () => {
    const sheetBacked = SEED_ACCOUNTS.filter((account) => account.externalSheetId !== null)

    expect(sheetBacked.map((account) => account.name)).toEqual(['EPCH'])
  })
})

describe('external form urls', () => {
  it('gives every account except EPCH a form url', () => {
    const withoutUrl = SEED_ACCOUNTS.filter((account) => account.externalFormUrl === null)

    expect(withoutUrl.map((account) => account.name)).toEqual(['EPCH'])
  })

  it('stores every url verbatim as a Google link', () => {
    for (const account of SEED_ACCOUNTS) {
      if (account.externalFormUrl === null) continue

      expect(account.externalFormUrl).toMatch(
        /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/,
      )
    }
  })
})

describe('parseFormId', () => {
  it('extracts the id from a /forms/d/{id}/edit authoring url', () => {
    expect(
      parseFormId(
        'https://docs.google.com/forms/d/1eWYEfHa-Eib8iUXT-2XmIkPAXkpMmrzu6PhCcIBVzcQ/edit',
      ),
    ).toBe('1eWYEfHa-Eib8iUXT-2XmIkPAXkpMmrzu6PhCcIBVzcQ')
  })

  it('returns null for a /forms/d/e/{id}/viewform url', () => {
    // That id is a response identifier, not a form id. Storing it would look
    // populated and fail at Milestone 8.
    expect(
      parseFormId(
        'https://docs.google.com/forms/d/e/1FAIpQLSffOc07nF19INV7OKVS-p6_fuXpWeaDbkGGC2yzPUOX-M2SSQ/viewform',
      ),
    ).toBeNull()
  })

  it('returns null for a forms.gle short link, which needs a redirect to resolve', () => {
    expect(parseFormId('https://forms.gle/8tpwpAabyM4enATU7')).toBeNull()
  })

  it('returns null for a spreadsheets url', () => {
    expect(
      parseFormId(
        'https://docs.google.com/spreadsheets/d/1m530xf7zHvKt9RIGBoHlaOKUfjNOxIugIdmHaxYpTaQ/edit',
      ),
    ).toBeNull()
  })

  it('returns null for null', () => {
    expect(parseFormId(null)).toBeNull()
  })

  it('resolves a form id for exactly the three /edit accounts', () => {
    const resolved = SEED_ACCOUNTS.filter(
      (account) => parseFormId(account.externalFormUrl) !== null,
    )

    expect(resolved.map((account) => account.name)).toEqual(['Mogu Mogu', 'Chemistry', 'Inkspired'])
  })

  it('extracts the exact ids for those three', () => {
    const byName = (name: string) =>
      parseFormId(SEED_ACCOUNTS.find((account) => account.name === name)?.externalFormUrl ?? null)

    expect(byName('Mogu Mogu')).toBe('1eWYEfHa-Eib8iUXT-2XmIkPAXkpMmrzu6PhCcIBVzcQ')
    expect(byName('Chemistry')).toBe('18BXE3by1PQaXxDXhjEqioT6i1uGZVGgmCNM9iZn8AiQ')
    expect(byName('Inkspired')).toBe('1LLWEH4bxQrlrg4Pj52bb-qqiGtnxP0QwN1fscZF_ERQ')
  })
})
