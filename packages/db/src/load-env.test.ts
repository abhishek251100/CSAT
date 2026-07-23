import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRootEnv } from './load-env'

/**
 * Regression cover for a real bug: seed.ts was given the same `../../.env`
 * relative path as drizzle.config.ts, but sits one directory deeper. It
 * resolved to packages/.env, dotenv loaded nothing without complaint, and the
 * failure surfaced as "DATABASE_URL is not set" from a file that visibly loads
 * .env. These tests pin the depth-independence that fix relies on.
 */

let root: string
const touchedKeys: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zoo-env-'))
})

afterEach(() => {
  for (const key of touchedKeys) delete process.env[key]
  touchedKeys.length = 0
  rmSync(root, { recursive: true, force: true })
})

function writeEnv(directory: string, body: string) {
  writeFileSync(join(directory, '.env'), body)
}

/** A module URL for a file that would live in `directory`. */
function moduleUrlIn(directory: string) {
  return pathToFileURL(join(directory, 'module.ts')).href
}

describe('loadRootEnv', () => {
  it('finds a .env sitting beside the calling module', () => {
    touchedKeys.push('ZOO_SAME_DIR')
    writeEnv(root, 'ZOO_SAME_DIR=beside\n')

    const loaded = loadRootEnv(moduleUrlIn(root))

    expect(loaded).toBe(join(root, '.env'))
    expect(process.env.ZOO_SAME_DIR).toBe('beside')
  })

  it('finds a .env several directories up, whatever the caller depth', () => {
    // The exact shape of the original bug: .env at the root, caller nested.
    touchedKeys.push('ZOO_NESTED')
    writeEnv(root, 'ZOO_NESTED=found\n')

    const nested = join(root, 'packages', 'db', 'src')
    mkdirSync(nested, { recursive: true })

    const loaded = loadRootEnv(moduleUrlIn(nested))

    expect(loaded).toBe(join(root, '.env'))
    expect(process.env.ZOO_NESTED).toBe('found')
  })

  it('loads the same file from two different depths', () => {
    // drizzle.config.ts (packages/db) and seed.ts (packages/db/src) must agree.
    touchedKeys.push('ZOO_SHARED')
    writeEnv(root, 'ZOO_SHARED=one-file\n')

    const shallow = join(root, 'packages', 'db')
    const deep = join(shallow, 'src')
    mkdirSync(deep, { recursive: true })

    expect(loadRootEnv(moduleUrlIn(shallow))).toBe(loadRootEnv(moduleUrlIn(deep)))
  })

  it('stops at the nearest .env rather than continuing to an outer one', () => {
    touchedKeys.push('ZOO_NEAREST')
    writeEnv(root, 'ZOO_NEAREST=outer\n')

    const inner = join(root, 'inner')
    mkdirSync(inner, { recursive: true })
    writeEnv(inner, 'ZOO_NEAREST=inner\n')

    loadRootEnv(moduleUrlIn(inner))

    expect(process.env.ZOO_NEAREST).toBe('inner')
  })

  it('never overrides a variable already set in the real environment', () => {
    // CI and deploy targets inject secrets that must beat a stray local file.
    touchedKeys.push('ZOO_PRESET')
    process.env.ZOO_PRESET = 'from-shell'
    writeEnv(root, 'ZOO_PRESET=from-file\n')

    loadRootEnv(moduleUrlIn(root))

    expect(process.env.ZOO_PRESET).toBe('from-shell')
  })

  it('returns null instead of throwing when no .env exists up the tree', () => {
    // Callers decide whether that is fatal — a real shell env may supply the vars.
    const orphan = mkdtempSync(join(tmpdir(), 'zoo-env-orphan-'))
    try {
      expect(loadRootEnv(moduleUrlIn(orphan))).toBeNull()
    } finally {
      rmSync(orphan, { recursive: true, force: true })
    }
  })
})
