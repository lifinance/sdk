import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { Keypair, nativeToScVal, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simulateTransaction = vi.fn()

// Mirrors the real wrapper: every rejection the callback produces is collected
// and collapsed into an AggregateError. That is exactly what must NOT happen to
// a deliberately classified error, so the mock has to be faithful or this suite
// would pass against the bug.
vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => {
    const servers = [{ simulateTransaction }, { simulateTransaction }]
    const errors: Error[] = []
    for (const server of servers) {
      try {
        return await fn(server)
      } catch (error) {
        errors.push(error as Error)
      }
    }
    throw new AggregateError(
      errors,
      `All ${servers.length} Stellar RPCs failed`
    )
  },
}))

const { readAllowance } = await import('./readAllowance.js')

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const SPENDER = StrKey.encodeContract(Buffer.alloc(32, 7))
const FROM = Keypair.random().publicKey()
const PASSPHRASE = 'Test SDF Network ; September 2015'

const read = () => readAllowance({} as never, TOKEN, FROM, SPENDER, PASSPHRASE)

describe('readAllowance', () => {
  beforeEach(() => {
    simulateTransaction.mockReset()
  })

  it('decodes the simulated allowance', async () => {
    simulateTransaction.mockResolvedValue({
      transactionData: {},
      latestLedger: 42,
      result: { retval: nativeToScVal(1_000n, { type: 'i128' }) },
    })

    await expect(read()).resolves.toBe(1_000n)
  })

  // Degrading to 0n would read as "needs approval" and prompt the user for an
  // approval that cannot help — so the failure has to reach parseStellarErrors
  // with its code intact rather than buried in an AggregateError.
  it('throws a classified error the failover wrapper cannot swallow', async () => {
    simulateTransaction.mockResolvedValue({
      error: 'HostError: Error(Contract, #13)',
      latestLedger: 42,
    })

    const thrown = await read().catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
    expect((thrown as TransactionError).message).toContain(
      'HostError: Error(Contract, #13)'
    )
  })

  // A contract-level failure is deterministic. Asking every remaining RPC the
  // same question only delays the answer.
  it('does not retry a deterministic simulation failure across RPCs', async () => {
    simulateTransaction.mockResolvedValue({
      error: 'HostError: Error(Contract, #13)',
      latestLedger: 42,
    })

    await read().catch(() => undefined)

    expect(simulateTransaction).toHaveBeenCalledTimes(1)
  })
})
