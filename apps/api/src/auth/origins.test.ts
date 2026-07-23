import { describe, expect, it } from 'vitest'
import { expandLoopbackOrigins, parseOriginList } from './origins'

/**
 * Regression cover for a real failure: the app was opened at
 * http://127.0.0.1:5173 while WEB_ORIGIN listed only http://localhost:5173.
 * CORS refused the preflight and the browser reported "Failed to fetch" with a
 * completely healthy API behind it.
 */

describe('parseOriginList', () => {
  it('parses a single origin', () => {
    expect(parseOriginList('http://localhost:5173')).toEqual(['http://localhost:5173'])
  })

  it('parses a comma-separated list and trims', () => {
    expect(parseOriginList(' http://localhost:5173 , https://cx.zoomedia.com ')).toEqual([
      'http://localhost:5173',
      'https://cx.zoomedia.com',
    ])
  })

  it('normalises a trailing slash away', () => {
    // The form browsers and humans both produce; not worth failing over.
    expect(parseOriginList('http://localhost:5173/')).toEqual(['http://localhost:5173'])
  })

  it('deduplicates', () => {
    expect(parseOriginList('http://localhost:5173,http://localhost:5173/')).toEqual([
      'http://localhost:5173',
    ])
  })

  it('preserves the port, which is part of the origin', () => {
    const origins = parseOriginList('http://localhost:5173,http://localhost:4173')

    expect(origins).toEqual(['http://localhost:5173', 'http://localhost:4173'])
  })

  it('rejects an empty list', () => {
    expect(() => parseOriginList('')).toThrow(/empty/i)
    expect(() => parseOriginList(' , ')).toThrow(/empty/i)
  })

  it('rejects a bare host with no scheme', () => {
    expect(() => parseOriginList('localhost:5173')).toThrow(/invalid origin|http or https/i)
  })

  it('rejects a non-http scheme', () => {
    expect(() => parseOriginList('ftp://localhost:5173')).toThrow(/http or https/i)
  })

  it('rejects an origin carrying a path, query or fragment', () => {
    // Silently truncating would hide a genuine configuration mistake.
    expect(() => parseOriginList('http://localhost:5173/app')).toThrow(/bare origin/i)
    expect(() => parseOriginList('http://localhost:5173/?x=1')).toThrow(/bare origin/i)
    expect(() => parseOriginList('http://localhost:5173/#top')).toThrow(/bare origin/i)
  })

  it('rejects the whole list when one entry is bad', () => {
    expect(() => parseOriginList('http://localhost:5173,not-a-url')).toThrow(/invalid origin/i)
  })
})

describe('expandLoopbackOrigins', () => {
  it('treats localhost, 127.0.0.1 and [::1] as the same machine', () => {
    const expanded = expandLoopbackOrigins(['http://localhost:5173'])

    expect(expanded).toContain('http://localhost:5173')
    expect(expanded).toContain('http://127.0.0.1:5173')
    expect(expanded).toContain('http://[::1]:5173')
  })

  it('expands from whichever spelling was configured', () => {
    const expanded = expandLoopbackOrigins(['http://127.0.0.1:5173'])

    expect(expanded).toContain('http://localhost:5173')
  })

  it('keeps the port', () => {
    const expanded = expandLoopbackOrigins(['http://localhost:4173'])

    expect(expanded).toContain('http://127.0.0.1:4173')
    expect(expanded).not.toContain('http://127.0.0.1:5173')
  })

  it('leaves a non-loopback origin untouched', () => {
    // Production hosts must be listed explicitly; nothing is inferred.
    expect(expandLoopbackOrigins(['https://cx.zoomedia.com'])).toEqual(['https://cx.zoomedia.com'])
  })

  it('does not invent a loopback origin when none was configured', () => {
    const expanded = expandLoopbackOrigins(['https://cx.zoomedia.com'])

    expect(expanded).not.toContain('http://localhost:5173')
  })

  it('is idempotent', () => {
    const once = expandLoopbackOrigins(['http://localhost:5173'])

    expect(expandLoopbackOrigins(once).sort()).toEqual(once.sort())
  })
})
