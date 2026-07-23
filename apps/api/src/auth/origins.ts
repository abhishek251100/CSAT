/**
 * Browser origin allowlist for CORS and better-auth's trusted origins.
 *
 * Separated and pure because getting this wrong produces one of the least
 * diagnosable failures in the stack: the server is healthy, the request never
 * arrives, and the browser reports only "Failed to fetch" with no detail.
 */

export class OriginListError extends Error {}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Parses a comma-separated origin list into normalised `scheme://host[:port]`.
 *
 * Strict: an entry carrying a path, query or fragment is a configuration
 * mistake, not something to silently truncate. A trailing slash is tolerated
 * and normalised away, since it is the form browsers and humans both produce.
 */
export function parseOriginList(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    throw new OriginListError('WEB_ORIGIN is empty. At least one browser origin is required.')
  }

  const origins = entries.map((entry) => {
    let url: URL

    try {
      url = new URL(entry)
    } catch {
      throw new OriginListError(
        `WEB_ORIGIN contains an invalid origin: ${entry}. ` +
          'Use scheme://host[:port], such as http://localhost:5173',
      )
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new OriginListError(`WEB_ORIGIN entry must be http or https: ${entry}`)
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new OriginListError(
        `WEB_ORIGIN entry must be a bare origin with no path, query or fragment: ${entry}`,
      )
    }

    return url.origin
  })

  return [...new Set(origins)]
}

/**
 * Treats the loopback spellings as equivalent — development only.
 *
 * Vite prints both `http://localhost:5173` and a `127.0.0.1` address, and the
 * two are the same machine but different CORS origins. Opening the one that was
 * not configured produces a bare "Failed to fetch" with a perfectly healthy
 * server behind it.
 *
 * Deliberately NOT applied in production: there, every origin must be listed
 * explicitly, because a loopback origin is meaningless to a remote browser and
 * quietly widening the allowlist is the wrong default for a security boundary.
 */
export function expandLoopbackOrigins(origins: readonly string[]): string[] {
  const expanded = new Set(origins)

  for (const origin of origins) {
    const url = new URL(origin)

    if (!LOOPBACK_HOSTS.includes(url.host.replace(/:\d+$/, ''))) continue

    for (const host of LOOPBACK_HOSTS) {
      expanded.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`)
    }
  }

  return [...expanded]
}
