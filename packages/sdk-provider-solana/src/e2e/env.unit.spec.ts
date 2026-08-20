import { describe, expect, it } from 'vitest'
import {
  assertSpendWithinCeiling,
  DEFAULT_USD_PER_LEG,
  isSkip,
  loadE2EEnv,
  parseRpcUrls,
} from './env.js'

describe('parseRpcUrls', () => {
  it('splits on commas and trims whitespace', () => {
    expect(parseRpcUrls(' https://a.example/ , https://b.example/ ')).toEqual([
      'https://a.example/',
      'https://b.example/',
    ])
  })

  it('drops empty segments from a trailing comma', () => {
    expect(parseRpcUrls('https://a.example/,')).toEqual(['https://a.example/'])
  })

  it('returns an empty array for undefined', () => {
    expect(parseRpcUrls(undefined)).toEqual([])
  })
})

describe('assertSpendWithinCeiling', () => {
  it('allows a plan under the ceiling', () => {
    expect(() => assertSpendWithinCeiling(3, 10)).not.toThrow()
  })

  it('rejects a plan over the ceiling with both numbers in the message', () => {
    // The ceiling exists because this harness spends real money. The message
    // must say what was planned and what the limit is, or the operator cannot
    // tell a misconfigured leg size from a too-low ceiling.
    expect(() => assertSpendWithinCeiling(25, 10)).toThrowError(/25.*10/)
  })

  it('rejects a plan exactly at the ceiling boundary plus epsilon', () => {
    expect(() => assertSpendWithinCeiling(10.01, 10)).toThrow()
    expect(() => assertSpendWithinCeiling(10, 10)).not.toThrow()
  })
})

describe('loadE2EEnv execute flag', () => {
  it('treats anything other than the exact string "true" as dry run', () => {
    // A truthy-but-not-"true" value must never broadcast. `E2E_EXECUTE=1`,
    // `=yes` and `=TRUE` are all plausible operator typos, and each one
    // spending real money would be a bad surprise.
    const original = process.env.E2E_EXECUTE
    try {
      for (const value of ['1', 'yes', 'TRUE', 'True', '']) {
        process.env.E2E_EXECUTE = value
        process.env.SOLANA_PK = 'test-key'
        process.env.SOLANA_RPC_URLS = 'https://a.example/'
        const env = loadE2EEnv('/nonexistent/.env')
        expect(isSkip(env)).toBe(false)
        if (!isSkip(env)) {
          expect(env.execute).toBe(false)
        }
      }

      process.env.E2E_EXECUTE = 'true'
      const enabled = loadE2EEnv('/nonexistent/.env')
      expect(isSkip(enabled)).toBe(false)
      if (!isSkip(enabled)) {
        expect(enabled.execute).toBe(true)
      }
    } finally {
      // `delete`, not `= undefined`: assigning undefined to process.env
      // stores the string "undefined", which is truthy and would leak into
      // every later test as a valid-looking private key.
      if (original === undefined) {
        delete process.env.E2E_EXECUTE
      } else {
        process.env.E2E_EXECUTE = original
      }
      delete process.env.SOLANA_PK
      delete process.env.SOLANA_RPC_URLS
    }
  })

  it('skips rather than throwing when credentials are absent', () => {
    // A contributor without a funded wallet must still be able to run every
    // other test in this package.
    const originals = {
      pk: process.env.SOLANA_PK,
      urls: process.env.SOLANA_RPC_URLS,
    }
    try {
      delete process.env.SOLANA_PK
      delete process.env.SOLANA_RPC_URLS
      const env = loadE2EEnv('/nonexistent/.env')
      expect(isSkip(env)).toBe(true)
      if (isSkip(env)) {
        expect(env.skip).toContain('SOLANA_PK')
      }
    } finally {
      if (originals.pk === undefined) {
        delete process.env.SOLANA_PK
      } else {
        process.env.SOLANA_PK = originals.pk
      }
      if (originals.urls === undefined) {
        delete process.env.SOLANA_RPC_URLS
      } else {
        process.env.SOLANA_RPC_URLS = originals.urls
      }
    }
  })
})

describe('loadE2EEnv leg size', () => {
  const withCreds = <T>(run: () => T): T => {
    const originals = {
      pk: process.env.SOLANA_PK,
      urls: process.env.SOLANA_RPC_URLS,
      leg: process.env.E2E_USD_PER_LEG,
    }
    process.env.SOLANA_PK = 'test-key'
    process.env.SOLANA_RPC_URLS = 'https://a.example/'
    try {
      return run()
    } finally {
      for (const [key, value] of [
        ['SOLANA_PK', originals.pk],
        ['SOLANA_RPC_URLS', originals.urls],
        ['E2E_USD_PER_LEG', originals.leg],
      ] as const) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  }

  it('defaults when E2E_USD_PER_LEG is unset', () => {
    withCreds(() => {
      delete process.env.E2E_USD_PER_LEG
      const env = loadE2EEnv('/nonexistent/.env')
      expect(isSkip(env)).toBe(false)
      if (!isSkip(env)) {
        expect(env.usdPerLeg).toBe(DEFAULT_USD_PER_LEG)
      }
    })
  })

  it('reads a supplied leg size', () => {
    withCreds(() => {
      process.env.E2E_USD_PER_LEG = '1.5'
      const env = loadE2EEnv('/nonexistent/.env')
      expect(isSkip(env)).toBe(false)
      if (!isSkip(env)) {
        expect(env.usdPerLeg).toBe(1.5)
      }
    })
  })

  it('skips rather than swapping a nonsense amount', () => {
    // A leg size of 0, -1 or "abc" reaching `amountForUsd` would either throw
    // mid-run or, worse, compute a garbage base-unit amount against a real
    // wallet. It is cheaper to refuse to start.
    for (const bad of ['0', '-1', 'abc']) {
      withCreds(() => {
        process.env.E2E_USD_PER_LEG = bad
        expect(isSkip(loadE2EEnv('/nonexistent/.env'))).toBe(true)
      })
    }
  })
})
