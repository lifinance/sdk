import { LiFiErrorCode, type TransactionError } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ sendTransaction }),
}))

// `fromXDR` is the only runtime member this module uses; everything else it
// imports from the SDK is a type and erases at build time.
vi.mock('@stellar/stellar-sdk', () => ({
  TransactionBuilder: { fromXDR: () => ({}) },
}))

const { submitStellarTransaction } = await import(
  './submitStellarTransaction.js'
)

const submit = () =>
  submitStellarTransaction({} as never, 'ENVELOPE_XDR', 'passphrase')

describe('submitStellarTransaction', () => {
  beforeEach(() => {
    sendTransaction.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the hash for PENDING and for DUPLICATE', async () => {
    sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h1' })
    await expect(submit()).resolves.toBe('h1')

    sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: 'h2' })
    await expect(submit()).resolves.toBe('h2')
  })

  // TRY_AGAIN_LATER means "valid, not queued, send it again" — treating it as
  // terminal turned ledger congestion into a failed route.
  it('retries TRY_AGAIN_LATER and succeeds', async () => {
    sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' })
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'h3' })

    const promise = submit()
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(promise).resolves.toBe('h3')
    expect(sendTransaction).toHaveBeenCalledTimes(3)
  })

  it('gives up on TRY_AGAIN_LATER after the attempt budget', async () => {
    sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER' })

    const promise = submit()
    const thrown = promise.then(() => undefined).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(((await thrown) as TransactionError).code).toBe(
      LiFiErrorCode.RateLimitExceeded
    )
    expect(sendTransaction).toHaveBeenCalledTimes(3)
  })

  it('throws immediately on a terminal status', async () => {
    sendTransaction.mockResolvedValue({ status: 'ERROR' })

    const thrown = await submit().catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionFailed
    )
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })
})
