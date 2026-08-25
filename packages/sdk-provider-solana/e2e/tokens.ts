export type E2EToken = {
  symbol: string
  mint: string
  decimals: number
  /** Approximate; only sizes a test leg. */
  approxPriceUsd: number
}

/**
 * USD* has two mints. `star9ag...` is the one with Perena routes, which is
 * what makes `jitoBundle: true` return a bundle; the token API returns the
 * other. Never resolve USD* by symbol.
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

/** Built as a BigInt, never through a float string: both `String(1e21)` and
 * `(1e21).toFixed(0)` yield `"1e+21"`, which `BigInt` rejects and the API
 * rejects too. */
export function amountForUsd(token: E2EToken, usd: number): string {
  if (!(usd > 0)) {
    throw new Error(`Leg size must be a positive dollar amount, got ${usd}`)
  }
  const tokenUnits = usd / token.approxPriceUsd
  const whole = Math.floor(tokenUnits)
  const scale = 10n ** BigInt(token.decimals)
  // `BigInt(number)` takes any integer-valued float, exponent range included,
  // so the whole part never round-trips through a string. The fraction is
  // bounded by `scale`, well inside Number's safe integer range.
  const fractionalUnits = BigInt(
    Math.round((tokenUnits - whole) * 10 ** token.decimals)
  )
  return (BigInt(whole) * scale + fractionalUnits).toString()
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
