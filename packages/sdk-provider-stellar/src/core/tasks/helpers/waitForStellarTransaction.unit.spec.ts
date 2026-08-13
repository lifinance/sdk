import { LiFiErrorCode, type TransactionError } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ getTransaction }),
}))

const { waitForStellarTransaction } = await import(
  './waitForStellarTransaction.js'
)

const POLL_MS = 3_000

describe('waitForStellarTransaction', () => {
  beforeEach(() => {
    getTransaction.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns as soon as the transaction is applied', async () => {
    const success = { status: rpc.Api.GetTransactionStatus.SUCCESS }
    getTransaction.mockResolvedValue(success)

    await expect(
      waitForStellarTransaction({} as never, 'h', POLL_MS)
    ).resolves.toBe(success)
  })

  it('reports an applied failure without waiting out the budget', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
      resultXdr: undefined,
    })

    const thrown = await waitForStellarTransaction({} as never, 'h', POLL_MS)
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionFailed
    )
  })

  // One rate-limit burst across every configured RPC must cost an interval, not
  // the whole wait — the transaction is still perfectly healthy.
  it('survives a transport failure and keeps polling', async () => {
    getTransaction
      .mockRejectedValueOnce(
        new AggregateError([new Error('429')], 'All 2 Stellar RPCs failed')
      )
      .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS })

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    await expect(promise).resolves.toEqual({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    })
    expect(getTransaction).toHaveBeenCalledTimes(2)
  })

  // The envelope's timebounds are `now + 300 s`, so the budget has to outlive
  // them: giving up at 90 s reported a still-live transaction as dead.
  it('polls past the 300 s timebounds before giving up', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    })

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    const thrown = promise.then(() => undefined).catch((error) => error)

    await vi.advanceTimersByTimeAsync(300_000)
    expect(getTransaction.mock.calls.length).toBeGreaterThan(95)

    await vi.advanceTimersByTimeAsync(35_000)
    expect(((await thrown) as TransactionError).code).toBe(
      LiFiErrorCode.Timeout
    )
  })

  it('carries the last transport error as the timeout cause', async () => {
    const transport = new AggregateError(
      [new Error('boom')],
      'All 2 Stellar RPCs failed'
    )
    getTransaction.mockRejectedValue(transport)

    const promise = waitForStellarTransaction({} as never, 'h', POLL_MS)
    const thrown = promise.then(() => undefined).catch((error) => error)
    await vi.advanceTimersByTimeAsync(335_000)

    expect(((await thrown) as TransactionError).cause).toBe(transport)
  })
})
