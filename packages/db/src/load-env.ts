import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads the repo-root .env by walking up from the calling module.
 *
 * Exists because a hand-counted relative path is quietly wrong the moment a
 * file moves between directory depths: `../../.env` reaches the repo root from
 * packages/db/drizzle.config.ts but only reaches packages/ from
 * packages/db/src/seed.ts. dotenv does not warn when the path it is given does
 * not exist, so the failure surfaces later as a confusing "DATABASE_URL is not
 * set" from a file that plainly loads .env.
 *
 * Walking up removes the count entirely. Returns the path it loaded, or null if
 * no .env was found before the filesystem root — callers decide whether that is
 * fatal, since a real shell environment may legitimately supply the vars.
 */
export function loadRootEnv(fromModuleUrl: string): string | null {
  let directory = dirname(fileURLToPath(fromModuleUrl))

  for (;;) {
    const candidate = join(directory, '.env')

    if (existsSync(candidate)) {
      // Never override a variable already set in the real environment: CI and
      // deploy targets inject secrets that must win over a local file.
      config({ path: candidate, quiet: true, override: false })
      return candidate
    }

    const parent = dirname(directory)
    if (parent === directory) return null

    directory = parent
  }
}
