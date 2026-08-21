import { describe, expect, it } from 'vitest'
import {
  amountForUsd,
  type E2EToken,
  planStandardMatrix,
  TOKENS,
} from './tokens.js'

describe('TOKENS', () => {
  it('uses the USD* mint that produces Perena routes', () => {
    // Two USD* mints exist. `/v1/token?chain=SOL&token=USD*` returns
    // BenJy1n..., which does NOT produce the Perena route the bundle path
    // needs. Resolving USD* by symbol silently selects the wrong one, and the
    // Jito phase then quietly tests the standard path instead.
    expect(TOKENS.USDSTAR.mint).toBe(
      'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM'
    )
    expect(TOKENS.USDSTAR.mint).not.toBe(
      'BenJy1n3WTx9mTjEvy63e8Q1j4RqUc6E4VBMz3ir4Wo6'
    )
  })

  it('gives every token a positive price so amounts can be derived', () => {
    for (const token of Object.values(TOKENS)) {
      expect(token.approxPriceUsd).toBeGreaterThan(0)
      expect(token.decimals).toBeGreaterThanOrEqual(0)
      expect(token.mint.length).toBeGreaterThan(30)
    }
  })
})

describe('amountForUsd', () => {
  it('converts dollars to base units for a 6-decimal stablecoin', () => {
    expect(amountForUsd(TOKENS.USDC, 0.25)).toBe('250000')
  })

  it('converts dollars to lamports for 9-decimal SOL', () => {
    const lamports = BigInt(amountForUsd(TOKENS.SOL, 0.25))
    expect(lamports).toBeGreaterThan(1_000_000n)
    expect(lamports).toBeLessThan(10_000_000n)
  })

  it('never returns a fractional or exponent-notation string', () => {
    // A base-unit amount goes straight into a JSON request. `1e+21` and
    // `250000.5` are both rejected by the API, and a float that large loses
    // precision silently.
    for (const token of Object.values(TOKENS)) {
      expect(amountForUsd(token, 0.25)).toMatch(/^\d+$/)
    }
  })

  it('rejects a non-positive dollar amount', () => {
    expect(() => amountForUsd(TOKENS.USDC, 0)).toThrow()
    expect(() => amountForUsd(TOKENS.USDC, -1)).toThrow()
  })

  it('survives an amount at the exponential-notation threshold', () => {
    // `(1e21).toFixed(0)` returns '1e+21' just as `String(1e21)` does, and
    // `BigInt('1e+21')` throws a SyntaxError. Only a value built as a BigInt
    // avoids the float round-trip the comment above claims to avoid.
    const cheap: E2EToken = {
      symbol: 'CHEAP',
      mint: 'CheapMint111111111111111111111111111111111',
      decimals: 9,
      approxPriceUsd: 1e-12,
    }

    expect(amountForUsd(cheap, 1)).toBe('1000000000000000000000')
  })
})

describe('planStandardMatrix', () => {
  it('produces every ordered pair of the four standard tokens', () => {
    expect(planStandardMatrix(0.25)).toHaveLength(12)
  })

  it('never pairs a token with itself', () => {
    for (const leg of planStandardMatrix(0.25)) {
      expect(leg.from.symbol).not.toBe(leg.to.symbol)
    }
  })

  it('excludes PENGU and USD*, which belong to the bundle phase', () => {
    const symbols = new Set(
      planStandardMatrix(0.25).flatMap((leg) => [
        leg.from.symbol,
        leg.to.symbol,
      ])
    )
    expect(symbols).toEqual(new Set(['USDT', 'USDC', 'SOL', 'WBTC']))
  })
})
