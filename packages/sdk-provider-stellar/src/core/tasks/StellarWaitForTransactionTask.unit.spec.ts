import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { Networks } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitStellarTransaction = vi.fn()
vi.mock('./helpers/submitStellarTransaction.js', () => ({
  submitStellarTransaction: (...args: unknown[]) =>
    submitStellarTransaction(...args),
}))

const waitForStellarTransaction = vi.fn()
vi.mock('./helpers/waitForStellarTransaction.js', () => ({
  waitForStellarTransaction: (...args: unknown[]) =>
    waitForStellarTransaction(...args),
}))

const probeStellarTransaction = vi.fn()
vi.mock('./helpers/probeStellarTransaction.js', () => ({
  probeStellarTransaction: (...args: unknown[]) =>
    probeStellarTransaction(...args),
}))

const { StellarWaitForTransactionTask } = await import(
  './StellarWaitForTransactionTask.js'
)

const makeContext = (
  action: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) => {
  const updateAction = vi.fn()
  return {
    updateAction,
    context: {
      client: {},
      step: {},
      networkPassphrase: Networks.TESTNET,
      isBridgeExecution: false,
      statusManager: { findAction: () => action, updateAction },
      ...overrides,
    } as never,
  }
}

describe('StellarWaitForTransactionTask', () => {
  beforeEach(() => {
    submitStellarTransaction.mockReset().mockResolvedValue('hash')
    waitForStellarTransaction.mockReset().mockResolvedValue({})
    probeStellarTransaction.mockReset().mockResolvedValue('not-found')
  })

  it('polls the hash produced by the signing task in the same run', async () => {
    const { context } = makeContext(
      { type: 'SWAP' },
      { transactionHash: 'fresh-hash' }
    )

    await new StellarWaitForTransactionTask().run(context)

    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'fresh-hash',
      undefined
    )
    // Already submitted in this run — must not submit again.
    expect(submitStellarTransaction).not.toHaveBeenCalled()
  })

  // The hash is persisted BEFORE submission, so on resume the envelope may never
  // have reached the network.
  it('re-submits on resume when the network does not know the hash', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'hash'
    })
    waitForStellarTransaction.mockImplementation(async () => {
      order.push('wait')
    })
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await new StellarWaitForTransactionTask().run(context)

    expect(order).toEqual(['submit', 'wait'])
    expect(submitStellarTransaction).toHaveBeenCalledWith(
      {},
      'PERSISTED_XDR',
      Networks.TESTNET
    )
    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'persisted-hash',
      undefined
    )
  })

  // Re-submitting an applied envelope can only fail: its sequence number is
  // spent. That failure used to mark a settled swap FAILED.
  it('does not re-submit a transaction the network has already applied', async () => {
    probeStellarTransaction.mockResolvedValue('landed')
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await new StellarWaitForTransactionTask().run(context)

    expect(submitStellarTransaction).not.toHaveBeenCalled()
    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'persisted-hash',
      undefined
    )
  })

  it('polls anyway when the re-submit fails', async () => {
    submitStellarTransaction.mockRejectedValue(new Error('txBadSeq'))
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(
      new StellarWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })
    expect(waitForStellarTransaction).toHaveBeenCalled()
  })

  it('reports the re-submit failure when a definite probe is followed by a timeout', async () => {
    const submitError = new Error('txTooLate')
    submitStellarTransaction.mockRejectedValue(submitError)
    waitForStellarTransaction.mockRejectedValue(
      new TransactionError(LiFiErrorCode.Timeout, 'not confirmed in time')
    )
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(new StellarWaitForTransactionTask().run(context)).rejects.toBe(
      submitError
    )
  })

  // After a failed probe the re-submit error may be a txBAD_SEQ from a swap that
  // in fact settled. Reporting it would be worse than the timeout.
  it('keeps the timeout when the probe itself failed', async () => {
    probeStellarTransaction.mockResolvedValue('unknown')
    submitStellarTransaction.mockRejectedValue(new Error('txBadSeq'))
    const timeout = new TransactionError(
      LiFiErrorCode.Timeout,
      'not confirmed in time'
    )
    waitForStellarTransaction.mockRejectedValue(timeout)
    const { context } = makeContext({
      type: 'SWAP',
      txHash: 'persisted-hash',
      txHex: 'PERSISTED_XDR',
    })

    await expect(new StellarWaitForTransactionTask().run(context)).rejects.toBe(
      timeout
    )
  })

  it('still polls on resume when no envelope was persisted', async () => {
    const { context } = makeContext({ type: 'SWAP', txHash: 'persisted-hash' })

    await new StellarWaitForTransactionTask().run(context)

    expect(submitStellarTransaction).not.toHaveBeenCalled()
    expect(waitForStellarTransaction).toHaveBeenCalledWith(
      {},
      'persisted-hash',
      undefined
    )
  })

  it('throws when neither the context nor the action carries a hash', async () => {
    const { context } = makeContext({ type: 'SWAP' })

    await expect(
      new StellarWaitForTransactionTask().run(context)
    ).rejects.toThrow(/Transaction hash is not found/)
  })

  it('marks a bridge action DONE but leaves a swap action for the status wait', async () => {
    const bridge = makeContext(
      { type: 'CROSS_CHAIN' },
      { isBridgeExecution: true, transactionHash: 'h' }
    )
    await new StellarWaitForTransactionTask().run(bridge.context)
    expect(bridge.updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'CROSS_CHAIN',
      'DONE'
    )

    const swap = makeContext({ type: 'SWAP' }, { transactionHash: 'h' })
    await new StellarWaitForTransactionTask().run(swap.context)
    expect(swap.updateAction).not.toHaveBeenCalled()
  })
})
