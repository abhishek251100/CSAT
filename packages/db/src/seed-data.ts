/**
 * Seed data — SPEC.md §13.
 *
 * One network (Zoo Media), one agency (The Starter Labs), and the 16 accounts
 * with their external Google references.
 */

export interface SeedAccount {
  readonly name: string
  readonly slug: string
  /**
   * The account's Google Form link. Null for EPCH, whose link is a Sheet, not
   * a Form (§13) — its reference lives on externalSheetId instead.
   */
  readonly externalFormUrl: string | null
  /**
   * §13: "EPCH's link is a Sheet, not a Form. Treat it as external_sheet_id
   * directly." Everything else is a Form whose response sheet must still be
   * located during sync setup (§7.1), so this stays null for them.
   */
  readonly externalSheetId: string | null
}

export const SEED_NETWORK = { name: 'Zoo Media', slug: 'zoo-media' } as const

export const SEED_AGENCY = { name: 'The Starter Labs', slug: 'the-starter-labs' } as const

/**
 * Extracts a Google Form id from an editor URL.
 *
 * Deliberately narrow: it matches only `/forms/d/{id}/edit`, the authoring URL,
 * where the path segment genuinely is the form id.
 *
 * It must NOT match the two other shapes in the account list:
 *
 *   - `/forms/d/e/{id}/viewform` — that id is a *response* identifier, not the
 *     form id. It cannot be used against the Forms API, and storing it in
 *     external_form_id would produce a column that looks populated and fails at
 *     Milestone 8.
 *   - `forms.gle/{slug}` — a short link that resolves to a form only by
 *     following a redirect, which seeding does not do.
 *
 * For both, external_form_id stays null and must be filled in during sync setup.
 * The negative lookahead on `e/` makes the `/d/e/` case explicit rather than
 * relying on the trailing `/edit` to fail to match.
 */
const FORM_EDIT_URL = /^https:\/\/docs\.google\.com\/forms\/d\/(?!e\/)([A-Za-z0-9_-]+)\/edit/

export function parseFormId(url: string | null): string | null {
  if (url === null) return null

  return FORM_EDIT_URL.exec(url)?.[1] ?? null
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    name: 'Mogu Mogu',
    slug: 'mogu-mogu',
    externalFormUrl:
      'https://docs.google.com/forms/d/1eWYEfHa-Eib8iUXT-2XmIkPAXkpMmrzu6PhCcIBVzcQ/edit',
    externalSheetId: null,
  },
  {
    name: 'Chemistry',
    slug: 'chemistry',
    externalFormUrl:
      'https://docs.google.com/forms/d/18BXE3by1PQaXxDXhjEqioT6i1uGZVGgmCNM9iZn8AiQ/edit',
    externalSheetId: null,
  },
  {
    name: 'Inkspired',
    slug: 'inkspired',
    externalFormUrl:
      'https://docs.google.com/forms/d/1LLWEH4bxQrlrg4Pj52bb-qqiGtnxP0QwN1fscZF_ERQ/edit',
    externalSheetId: null,
  },
  {
    name: 'SOA',
    slug: 'soa',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSffOc07nF19INV7OKVS-p6_fuXpWeaDbkGGC2yzPUOX-M2SSQ/viewform',
    externalSheetId: null,
  },
  {
    name: 'The Croffle Guys',
    slug: 'the-croffle-guys',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSe0YFItHcRy_YaXQGLHjI9K1tXKialHiMmMFVIlnNtGuAc36w/viewform',
    externalSheetId: null,
  },
  {
    name: 'Anemos',
    slug: 'anemos',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLScB6PoM4Xq5LZLUYuqiEHsoK60xiYPkEQhvYym_O_dftSBDGg/viewform',
    externalSheetId: null,
  },
  {
    name: 'Standard Chartered',
    slug: 'standard-chartered',
    externalFormUrl: 'https://forms.gle/8tpwpAabyM4enATU7',
    externalSheetId: null,
  },
  {
    name: 'WhiteOak',
    slug: 'whiteoak',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLScmWkbOzVVNWe_BnJ8OB9DE_7W090ySsxNb09AAeS7K17Q5wA/viewform',
    externalSheetId: null,
  },
  {
    name: 'Alka Seltzer',
    slug: 'alka-seltzer',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSfphW1UE7TQ-hhHQANdc3Lf5L1zi_pDlddmgRQhHhhcZgizZA/viewform',
    externalSheetId: null,
  },
  {
    name: 'BuildWell',
    slug: 'buildwell',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSd9zxbrj_VR-nfvFM8qabJOnq-v0EaIpM8M0sCN9hI783JTyw/viewform',
    externalSheetId: null,
  },
  {
    name: 'Spunge',
    slug: 'spunge',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSdfoC62Ao3wkndlyl0kTo5F-dpL4A2sn0igD5Y1rHVdXz0DHg/viewform',
    externalSheetId: null,
  },
  {
    // §13: Sheet-backed, not Form-backed. Both form columns stay null.
    name: 'EPCH',
    slug: 'epch',
    externalFormUrl: null,
    externalSheetId: '1m530xf7zHvKt9RIGBoHlaOKUfjNOxIugIdmHaxYpTaQ',
  },
  {
    name: 'AJ',
    slug: 'aj',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSeQeH67Xi7fhByBVU0haJChH9dR5XrkKNRcQYg_30KuV3Czwg/viewform',
    externalSheetId: null,
  },
  {
    name: 'Ryan',
    slug: 'ryan',
    externalFormUrl: 'https://forms.gle/UdtJiwVFT5fqEaZXA',
    externalSheetId: null,
  },
  {
    name: 'HyKr Venture Studio',
    slug: 'hykr-venture-studio',
    externalFormUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSfAmNDtrl3ihb48EIWpcack2j0LoAkPQ_PNOEMUb42uDzEVsw/viewform',
    externalSheetId: null,
  },
  {
    name: 'Sunteck',
    slug: 'sunteck',
    externalFormUrl: 'https://forms.gle/F5fBqVVBS657ynf46',
    externalSheetId: null,
  },
] as const
