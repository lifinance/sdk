export type E2EToken = {
  symbol: string
  mint: string
  decimals: number
  /**
   * Only used to size a test leg. Deliberately approximate - the assertions
   * read live prices from each quote, so a stale constant here shifts the leg
   * size by a few cents and never changes a verdict.
   */
  approxPriceUsd: number
}

/**
 * Mint addresses verified against the LI.FI token API on 2026-08-20.
 *
 * USD* has two mints in circulation. `star9ag...` is the one whose routes
 * include the Perena protocol step, and that step is what makes
 * `jitoBundle: true` return a bundle. `BenJy1n...` is what the token API
 * returns for the symbol and does not produce that route, so resolving USD*
 * by symbol picks the mint that cannot test the bundle path.
 */
/** Named so each token is reachable as `TOKENS.USDC` with a literal type. */
export type E2ETokenName =
  | 'USDT'
  | 'USDC'
  | 'SOL'
  | 'WBTC'
  | 'PENGU'
  | 'USDSTAR'

export const TOKENS: Record<E2ETokenName, E2EToken> = {
  USDT: {
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    approxPriceUsd: 1,
  },
  USDC: {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    approxPriceUsd: 1,
  },
  SOL: {
    symbol: 'SOL',
    mint: '11111111111111111111111111111111',
    decimals: 9,
    approxPriceUsd: 87.37,
  },
  WBTC: {
    symbol: 'WBTC',
    mint: '5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ',
    decimals: 8,
    approxPriceUsd: 71_764.5,
  },
  PENGU: {
    symbol: 'PENGU',
    mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
    decimals: 6,
    approxPriceUsd: 0.006_748,
  },
  USDSTAR: {
    symbol: 'USD*',
    mint: 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM',
    decimals: 6,
    approxPriceUsd: 1.09,
  },
}

/** The four tokens the standard-path matrix cycles through. */
const STANDARD: E2EToken[] = [TOKENS.USDT, TOKENS.USDC, TOKENS.SOL, TOKENS.WBTC]

/**
 * Converts a dollar amount to the token's base units.
 *
 * Built through a fixed-point string into a BigInt rather than a Number: a
 * WBTC amount at 8 decimals leaves the safe integer range once the price is
 * large, and `String(1e21)` yields `"1e+21"`, which the API rejects.
 */
export function amountForUsd(token: E2EToken, usd: number): string {
  if (!(usd > 0)) {
    throw new Error(`Leg size must be a positive dollar amount, got ${usd}`)
  }
  const tokenUnits = usd / token.approxPriceUsd
  const scaled = (tokenUnits * 10 ** token.decimals).toFixed(0)
  return BigInt(scaled).toString()
}

export type StandardLeg = {
  from: E2EToken
  to: E2EToken
  fromAmount: string
}

/** Every ordered pair of the four standard tokens: 4 x 3 = 12 legs. */
export function planStandardMatrix(usdPerLeg: number): StandardLeg[] {
  const legs: StandardLeg[] = []
  for (const from of STANDARD) {
    for (const to of STANDARD) {
      if (from.symbol === to.symbol) {
        continue
      }
      legs.push({ from, to, fromAmount: amountForUsd(from, usdPerLeg) })
    }
  }
  return legs
}
