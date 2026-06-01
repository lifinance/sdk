import { ChainId, type Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// SPL Token program ids — mirror the constants in getSolanaBalance.ts so the
// fake RPC can answer each program's account query independently.
const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

const callSolanaRpcsWithRetry = vi.fn()
vi.mock('../rpc/utils.js', () => ({
  callSolanaRpcsWithRetry: (...args: unknown[]) =>
    callSolanaRpcsWithRetry(...args),
}))

const { getSolanaBalance } = await import('./getSolanaBalance.js')

// A real, valid base58 wallet address — getSolanaBalance runs it through
// @solana/kit's address(), which validates the input.
const WALLET = '9T655zHa6bYrTHWdy59NFqkjwoaSwfMat2yzixE1nb56'
const HELD_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// A mint the wallet doesn't hold. Token addresses are only used as in-memory
// lookup keys (never passed to address()), so the value is unconstrained —
// this mirrors the "invalid data" case the old live integration test covered.
const UNHELD_MINT = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'

const token = (address: string): Token => ({
  chainId: ChainId.SOL,
  address,
  symbol: 'TKN',
  decimals: 6,
  name: 'Token',
  priceUSD: '0',
})

const tokenAccount = (mint: string, amount: string) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount } } } } },
})

// A fake @solana/kit RPC whose token-account queries resolve per program id.
// An `Error` value makes that program's query reject, which getSolanaBalance
// treats as a failed program query (rate-limit / RPC flake).
const fakeRpc = (accountsByProgram: Record<string, object[] | Error>) => ({
  getSlot: () => ({ send: () => Promise.resolve(123n) }),
  getBalance: () => ({ send: () => Promise.resolve({ value: 0n }) }),
  getTokenAccountsByOwner: (
    _owner: unknown,
    filter: { programId: unknown }
  ) => ({
    send: () => {
      const result = accountsByProgram[String(filter.programId)] ?? []
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ value: result })
    },
  }),
})

// Route the action's callSolanaRpcsWithRetry(client, fn) through the fake rpc,
// so the real dispatch/aggregation logic runs against deterministic data.
const driveWith = (rpc: object): void => {
  callSolanaRpcsWithRetry.mockImplementation(
    (_client: unknown, fn: (rpc: object) => Promise<unknown>) => fn(rpc)
  )
}

describe('getSolanaBalance', () => {
  beforeEach(() => {
    callSolanaRpcsWithRetry.mockReset()
  })

  it('returns an empty list without touching the RPC when no tokens are requested', async () => {
    const balances = await getSolanaBalance({} as never, WALLET, [])

    expect(balances).toEqual([])
    expect(callSolanaRpcsWithRetry).not.toHaveBeenCalled()
  })

  it('reports an unheld mint as a known zero when both program queries succeed', async () => {
    driveWith(
      fakeRpc({
        [TokenProgramId]: [tokenAccount(HELD_MINT, '500')],
        [Token2022ProgramId]: [],
      })
    )

    const balances = await getSolanaBalance({} as never, WALLET, [
      token(HELD_MINT),
      token(UNHELD_MINT),
    ])

    const held = balances.find((balance) => balance.address === HELD_MINT)
    const unheld = balances.find((balance) => balance.address === UNHELD_MINT)
    expect(held?.amount).toBe(500n)
    expect(held?.blockNumber).toBe(123n)
    // Both Token and Token2022 queries succeeded → a definite zero.
    expect(unheld?.amount).toBe(0n)
    expect(unheld?.blockNumber).toBe(123n)
  })

  it('reports an unheld mint as unknown (undefined) when a program query fails', async () => {
    driveWith(
      fakeRpc({
        [TokenProgramId]: [],
        [Token2022ProgramId]: new Error('RPC rate-limited'),
      })
    )

    const [unheld] = await getSolanaBalance({} as never, WALLET, [
      token(UNHELD_MINT),
    ])

    // A program query was rejected, so a missing mint can't be reported as a
    // confident zero — it stays undefined (graceful degradation, no throw).
    expect(unheld.amount).toBeUndefined()
    expect(unheld.blockNumber).toBe(123n)
  })
})
