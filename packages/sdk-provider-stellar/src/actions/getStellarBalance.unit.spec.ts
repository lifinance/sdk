import type { Token } from '@lifi/sdk'
import { Keypair, nativeToScVal, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simulateTransaction = vi.fn()

vi.mock('../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ simulateTransaction }),
}))

const { getStellarBalance } = await import('./getStellarBalance.js')

const WALLET = Keypair.random().publicKey()
const PASSPHRASE = 'Test SDF Network ; September 2015'

const token = (fill: number): Token =>
  ({
    address: StrKey.encodeContract(Buffer.alloc(32, fill)),
    chainId: 1500,
    decimals: 7,
    symbol: 'TKN',
  }) as Token

const balanceOf = (amount: bigint) => ({
  transactionData: {},
  latestLedger: 99,
  result: { retval: nativeToScVal(amount, { type: 'i128' }) },
})

describe('getStellarBalance', () => {
  beforeEach(() => {
    simulateTransaction.mockReset()
  })

  it('returns amounts and the ledger each read ran against', async () => {
    simulateTransaction.mockResolvedValue(balanceOf(500n))

    const [balance] = await getStellarBalance(
      {} as never,
      WALLET,
      [token(4)],
      PASSPHRASE
    )

    expect(balance.amount).toBe(500n)
    expect(balance.blockNumber).toBe(99n)
  })

  // Consumers read a missing blockNumber as an unsettled balance and poll
  // forever, so a wholly failed batch has to surface as a failure.
  it('throws when every read fails', async () => {
    simulateTransaction.mockRejectedValue(
      new Error('RPC URL not found for chainId: 1500')
    )

    await expect(
      getStellarBalance({} as never, WALLET, [token(4), token(5)], PASSPHRASE)
    ).rejects.toThrow(/RPC URL not found/)
  })

  it('lets a failed read borrow the batch ledger when another read succeeded', async () => {
    simulateTransaction
      .mockRejectedValueOnce(new Error('contract not found'))
      .mockResolvedValue(balanceOf(700n))

    const [failed, ok] = await getStellarBalance(
      {} as never,
      WALLET,
      [token(4), token(5)],
      PASSPHRASE
    )

    expect(failed.amount).toBeUndefined()
    expect(failed.blockNumber).toBe(99n)
    expect(ok.amount).toBe(700n)
  })
})
