import { rpc } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTransaction = vi.fn()

vi.mock('../../../client/getStellarRpc.js', () => ({
  callStellarRpcsWithRetry: async (
    _client: unknown,
    fn: (server: unknown) => Promise<unknown>
  ) => fn({ getTransaction }),
}))

const { probeStellarTransaction } = await import('./probeStellarTransaction.js')

describe('probeStellarTransaction', () => {
  beforeEach(() => {
    getTransaction.mockReset()
  })

  it('reports a transaction the network has applied', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'landed'
    )
  })

  // A FAILED transaction still consumed the sequence number, so re-submitting
  // the same envelope can only fail.
  it('treats an applied failure as landed', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'landed'
    )
  })

  it('reports NOT_FOUND distinctly from a failed probe', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    })

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'not-found'
    )
  })

  // The caller must not trust a re-submit error after this: the transaction may
  // well have landed and the network simply could not tell us.
  it('reports unknown when every RPC rejects', async () => {
    getTransaction.mockRejectedValue(
      new AggregateError([new Error('boom')], 'All 2 Stellar RPCs failed')
    )

    await expect(probeStellarTransaction({} as never, 'h')).resolves.toBe(
      'unknown'
    )
  })
})
