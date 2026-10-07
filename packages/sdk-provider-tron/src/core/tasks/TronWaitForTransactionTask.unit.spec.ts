import type { SDKClient } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const waitForTronTxConfirmation = vi.fn()
vi.mock('../../rpc/waitForTronTxConfirmation.js', () => ({
  waitForTronTxConfirmation: (...args: unknown[]) =>
    waitForTronTxConfirmation(...args),
}))

const { isFinalTransactionError, LiFiErrorCode, TransactionError } =
  await import('@lifi/sdk')
const { withTronNodes } = await import(
  '../../rpc/callTronRpcsWithRetry.unit.mock.js'
)
const { TronWaitForTransactionTask } = await import(
  './TronWaitForTransactionTask.js'
)

const TX_ID = 'c3e7a4c5c0b8d2f1e9a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809102'
const EXPIRATION = 1_790_000_060_000
// Head bound of the dropped rule: past expiration + 5 min.
const HEAD_PAST = EXPIRATION + 5 * 60_000 + 1
const EXPLORER = 'https://tronscan.org/'
const TX_LINK = `https://tronscan.org#/transaction/${TX_ID}`

const SIGNED_TRANSACTION = {
  visible: false,
  txID: TX_ID,
  raw_data: {
    contract: [],
    ref_block_bytes: '1a2b',
    ref_block_hash: '0011223344556677',
    expiration: EXPIRATION,
    timestamp: EXPIRATION - 60_000,
  },
  raw_data_hex: '0a021a2b',
  signature: ['c0ffee'],
}
const TX_HEX = JSON.stringify(SIGNED_TRANSACTION)

type Send = (transaction: unknown) => Promise<unknown>
const accepts: Send = async (transaction) => ({ result: true, transaction })
// A code that java-tron returns before the pending-pool push.
const refuses: Send = async () => ({
  result: false,
  code: 'TRANSACTION_EXPIRATION_ERROR',
})
// java-tron returns this code after the push: the node may hold it.
const refusesAfterPush: Send = async () => ({
  result: false,
  code: 'NOT_ENOUGH_EFFECTIVE_CONNECTION',
})
const networkError: Send = async () => {
  throw new Error('socket hang up')
}

/**
 * One fake TronWeb per RPC URL (seeded with `withTronNodes`).
 * `callTronRpcsWithRetry` stays real and tries them in order, so a test
 * controls every send attempt.
 */
const makeNode = (send: Send) => ({
  trx: {
    sendRawTransaction: vi.fn(send),
    getCurrentBlock: vi.fn(async () => ({
      block_header: { raw_data: { timestamp: EXPIRATION - 30_000 } },
    })),
    // The node has not included the transaction.
    getUnconfirmedTransactionInfo: vi.fn(async () => ({})),
  },
})

const makeContext = (
  client: SDKClient,
  action: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) => {
  const updateAction = vi.fn()
  return {
    updateAction,
    context: {
      client,
      step: { execution: {} },
      fromChain: { metamask: { blockExplorerUrls: [EXPLORER] } },
      isBridgeExecution: false,
      statusManager: { findAction: () => action, updateAction },
      ...overrides,
    } as never,
  }
}

type UpdateAction = ReturnType<typeof vi.fn>

/** True when some write set `txHex` to `undefined`. */
const clearedTxHex = (updateAction: UpdateAction): boolean =>
  updateAction.mock.calls.some(
    ([, , , params]) =>
      !!params && 'txHex' in params && params.txHex === undefined
  )

/** Every PENDING write: its params and its place in the global call order. */
const pendingWrites = (updateAction: UpdateAction) =>
  updateAction.mock.calls.flatMap(([, , status, params], index) =>
    status === 'PENDING' && params
      ? [
          {
            params: params as Record<string, unknown>,
            order: updateAction.mock.invocationCallOrder[index],
          },
        ]
      : []
  )

/**
 * An accepted send writes the hash before the wait starts, and keeps `txHex`
 * (no `txHex` key). The keys are listed because `toHaveBeenCalledWith`
 * ignores the `txHex: undefined` of the later confirmation write, which would
 * then match as well.
 */
const expectHashWrittenBeforeWait = (updateAction: UpdateAction) => {
  const [waitOrder] = waitForTronTxConfirmation.mock.invocationCallOrder
  const write = pendingWrites(updateAction).find(
    ({ params, order }) => order < waitOrder && 'txHash' in params
  )
  expect(write?.params).toEqual({ txHash: TX_ID, txLink: TX_LINK })
  expect(Object.keys(write?.params ?? {}).sort()).toEqual(['txHash', 'txLink'])
}

/** The last PENDING write carries the hash and clears `txHex`, key by key. */
const expectIncludedWrite = (updateAction: UpdateAction) => {
  const params = pendingWrites(updateAction).at(-1)?.params ?? {}
  expect(params.txHash).toBe(TX_ID)
  expect(params.txLink).toBe(TX_LINK)
  expect('txHex' in params).toBe(true)
  expect(params.txHex).toBeUndefined()
}

const confirmationTimeout = () =>
  new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction confirmation timeout.'
  )

describe('TronWaitForTransactionTask', () => {
  beforeEach(() => {
    waitForTronTxConfirmation.mockReset().mockResolvedValue(undefined)
    // Veto only: an unknown hash says nothing.
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('first run (signed transaction in memory)', () => {
    it('broadcasts, writes the hash before the wait, confirms and clears txHex', async () => {
      const node = makeNode(accepts)
      const { context, updateAction } = makeContext(
        withTronNodes(node),
        { type: 'CROSS_CHAIN', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION, isBridgeExecution: true }
      )

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(node.trx.sendRawTransaction).toHaveBeenCalledWith(
        SIGNED_TRANSACTION
      )
      expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
        expect.anything(),
        TX_ID
      )
      expectHashWrittenBeforeWait(updateAction)
      expectIncludedWrite(updateAction)
      expect(updateAction).toHaveBeenLastCalledWith(
        expect.anything(),
        'CROSS_CHAIN',
        'DONE'
      )
    })

    it('clears txHex when every send attempt got a definite rejection', async () => {
      const { context, updateAction } = makeContext(
        withTronNodes(makeNode(refuses), makeNode(refuses)),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      const error = await new TronWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toMatchObject({ message: 'All 2 Tron RPCs failed' })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(true)
      expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
    })

    // Nothing left the SDK: the error comes before the first send attempt.
    it('clears txHex when no RPC is available to send it', async () => {
      const { context, updateAction } = makeContext(
        withTronNodes(),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      const error = await new TronWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toMatchObject({ message: 'No Tron RPC URLs available' })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(true)
      expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
    })

    it.each([
      ['a rejection, then a network error', [refuses, networkError]],
      ['a network error, then a rejection', [networkError, refuses]],
      [
        'NOT_ENOUGH_EFFECTIVE_CONNECTION from every node',
        [refusesAfterPush, refusesAfterPush],
      ],
    ])(
      'keeps txHex after %s: the outcome is unknown',
      async (_label, sends) => {
        const { context, updateAction } = makeContext(
          withTronNodes(...sends.map(makeNode)),
          { type: 'SWAP', txHex: TX_HEX },
          { signedTransaction: SIGNED_TRANSACTION }
        )

        const error = await new TronWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)

        expect(error).toMatchObject({ message: 'All 2 Tron RPCs failed' })
        expect(isFinalTransactionError(error)).toBe(false)
        expect(clearedTxHex(updateAction)).toBe(false)
        expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
      }
    )

    it('clears txHex and rethrows a final on-chain failure', async () => {
      const onChainFailure = new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction failed on-chain: REVERT.',
        undefined,
        { final: true }
      )
      waitForTronTxConfirmation.mockRejectedValue(onChainFailure)
      const { context, updateAction } = makeContext(
        withTronNodes(makeNode(accepts)),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      await expect(new TronWaitForTransactionTask().run(context)).rejects.toBe(
        onChainFailure
      )
      expectIncludedWrite(updateAction)
    })

    it('keeps txHex on a confirmation timeout before the expiry', async () => {
      const timeout = confirmationTimeout()
      waitForTronTxConfirmation.mockRejectedValue(timeout)
      const { context, updateAction } = makeContext(
        withTronNodes(makeNode(accepts)),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      await expect(new TronWaitForTransactionTask().run(context)).rejects.toBe(
        timeout
      )
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    // Expired, but the head is not yet 5 min past the expiration: a lagging
    // node could still be missing the block with the transaction.
    it('keeps txHex after a timeout while the head is less than 5 min past the expiry', async () => {
      const node = makeNode(accepts)
      node.trx.getCurrentBlock.mockResolvedValue({
        block_header: { raw_data: { timestamp: EXPIRATION + 2 * 60_000 } },
      })
      const timeout = confirmationTimeout()
      waitForTronTxConfirmation.mockRejectedValue(timeout)
      const { context, updateAction } = makeContext(
        withTronNodes(node),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      await expect(new TronWaitForTransactionTask().run(context)).rejects.toBe(
        timeout
      )
      expect(clearedTxHex(updateAction)).toBe(false)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
    })

    it('reports a dropped transaction as final when the wait ends after the expiry', async () => {
      const node = makeNode(accepts)
      node.trx.getCurrentBlock.mockResolvedValue({
        block_header: { raw_data: { timestamp: HEAD_PAST } },
      })
      waitForTronTxConfirmation.mockRejectedValue(confirmationTimeout())
      const { context, updateAction } = makeContext(
        withTronNodes(node),
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: SIGNED_TRANSACTION }
      )

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        message: 'Transaction expired before it was included in a block.',
        final: true,
      })
      expect(clearedTxHex(updateAction)).toBe(true)
    })
  })

  describe('resume (nothing in memory)', () => {
    it('resends exactly the stored transaction, then confirms by its txID', async () => {
      const node = makeNode(accepts)
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(node.trx.sendRawTransaction).toHaveBeenCalledTimes(1)
      expect(node.trx.sendRawTransaction).toHaveBeenCalledWith(
        JSON.parse(TX_HEX)
      )
      expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
        expect.anything(),
        TX_ID
      )
      // Accepted resend: the hash is written as on the first run.
      expectHashWrittenBeforeWait(updateAction)
      expectIncludedWrite(updateAction)
    })

    // The first send may already be included, so a refusal of the resend
    // (DUP aside) says nothing about the outcome.
    it.each([
      ['every node refuses', [refuses, refuses]],
      ['every node fails', [networkError, networkError]],
    ])(
      'ignores the resend result when %s and still confirms',
      async (_label, sends) => {
        const { context } = makeContext(withTronNodes(...sends.map(makeNode)), {
          type: 'SWAP',
          txHex: TX_HEX,
        })

        await expect(
          new TronWaitForTransactionTask().run(context)
        ).resolves.toEqual({ status: 'COMPLETED' })
        expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
          expect.anything(),
          TX_ID
        )
      }
    )

    it('keeps txHex when every node refuses the resend and the wait times out', async () => {
      const timeout = confirmationTimeout()
      waitForTronTxConfirmation.mockRejectedValue(timeout)
      const { context, updateAction } = makeContext(
        withTronNodes(makeNode(refuses), makeNode(refuses)),
        { type: 'SWAP', txHex: TX_HEX }
      )

      const error = await new TronWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toBe(timeout)
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    // An earlier run may have sent the bytes, so an error before the resend
    // leaves the outcome unknown.
    it('keeps txHex when no RPC is available to resend it', async () => {
      const rpcError = new Error('No Tron RPC URLs available')
      waitForTronTxConfirmation.mockRejectedValue(rpcError)
      const { context, updateAction } = makeContext(withTronNodes(), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(new TronWaitForTransactionTask().run(context)).rejects.toBe(
        rpcError
      )
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    describe('stored txID that is not the stored txHash (damaged storage)', () => {
      const NOW = 1_790_000_000_000
      const OTHER_TX_ID =
        'd4f8b5d6d1c9e3f2fab7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3'

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
      })

      // The stored bytes prove nothing about the stored txHash, and they may
      // have been sent. Both drop checks would fire here: the head is past
      // the stored expiration, and the signing time is 20 minutes old.
      it('never sends or drops, and waits by the stored txHash', async () => {
        const node = makeNode(accepts)
        node.trx.getCurrentBlock.mockResolvedValue({
          block_header: { raw_data: { timestamp: HEAD_PAST } },
        })
        const timeout = confirmationTimeout()
        waitForTronTxConfirmation.mockRejectedValue(timeout)
        const { context, updateAction } = makeContext(
          withTronNodes(node),
          { type: 'SWAP', txHash: OTHER_TX_ID, txHex: TX_HEX },
          { step: { execution: { signedAt: NOW - 20 * 60_000 } } }
        )

        const error = await new TronWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)

        expect(error).toBe(timeout)
        expect(isFinalTransactionError(error)).toBe(false)
        expect(node.trx.sendRawTransaction).not.toHaveBeenCalled()
        expect(node.trx.getUnconfirmedTransactionInfo).not.toHaveBeenCalled()
        expect(isKnownToStatusApi).not.toHaveBeenCalled()
        expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
          expect.anything(),
          OTHER_TX_ID
        )
        // txHex and txHash stay.
        expect(updateAction).not.toHaveBeenCalled()
      })

      // A hex hash does not depend on its case.
      it('treats a txHash that differs only in case as the same transaction', async () => {
        const node = makeNode(accepts)
        const { context } = makeContext(withTronNodes(node), {
          type: 'SWAP',
          txHash: TX_ID.toUpperCase(),
          txHex: TX_HEX,
        })

        await expect(
          new TronWaitForTransactionTask().run(context)
        ).resolves.toEqual({ status: 'COMPLETED' })
        expect(node.trx.sendRawTransaction).toHaveBeenCalledTimes(1)
      })
    })

    it('strips a 0x prefix from the stored txID', async () => {
      const prefixedTxHex = JSON.stringify({
        ...SIGNED_TRANSACTION,
        txID: `0x${TX_ID}`,
      })
      const node = makeNode(accepts)
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: prefixedTxHex,
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      // The stored bytes are resent unchanged.
      expect(node.trx.sendRawTransaction).toHaveBeenCalledWith(
        JSON.parse(prefixedTxHex)
      )
      expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
        expect.anything(),
        TX_ID
      )
      expectHashWrittenBeforeWait(updateAction)
      expectIncludedWrite(updateAction)
    })

    it('reports an expired transaction as dropped before waiting', async () => {
      const node = makeNode(accepts)
      node.trx.getCurrentBlock.mockResolvedValue({
        block_header: { raw_data: { timestamp: HEAD_PAST } },
      })
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        final: true,
      })
      expect(node.trx.sendRawTransaction).not.toHaveBeenCalled()
      expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(true)
    })

    it('reports a dropped transaction as final when the wait ends after the expiry', async () => {
      const node = makeNode(accepts)
      // The head is not yet past the bound before the wait, but it is after.
      node.trx.getCurrentBlock
        .mockResolvedValueOnce({
          block_header: { raw_data: { timestamp: EXPIRATION - 30_000 } },
        })
        .mockResolvedValue({
          block_header: { raw_data: { timestamp: HEAD_PAST } },
        })
      waitForTronTxConfirmation.mockRejectedValue(confirmationTimeout())
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        message: 'Transaction expired before it was included in a block.',
        final: true,
      })
      expect(node.trx.sendRawTransaction).toHaveBeenCalledTimes(1)
      expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
        expect.anything(),
        TX_ID
      )
      expect(clearedTxHex(updateAction)).toBe(true)
    })

    // With a `Date.now()` head, the node would cover the window (1 h past the
    // expiration, well inside 24 h) and the transaction would be dropped.
    it('uses block time: a local clock an hour ahead does not expire the transaction', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(EXPIRATION + 60 * 60_000)
      const node = makeNode(accepts)
      const { context } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expect(node.trx.sendRawTransaction).toHaveBeenCalled()
    })

    it('does not drop an expired transaction that the status API still knows', async () => {
      isKnownToStatusApi.mockResolvedValue(true)
      const node = makeNode(refuses)
      node.trx.getCurrentBlock.mockResolvedValue({
        block_header: { raw_data: { timestamp: HEAD_PAST } },
      })
      const timeout = confirmationTimeout()
      waitForTronTxConfirmation.mockRejectedValue(timeout)
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(new TronWaitForTransactionTask().run(context)).rejects.toBe(
        timeout
      )
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('clears an invalid txHex and fails non-final when there is no txHash', async () => {
      const node = makeNode(accepts)
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHex: '{"txID":',
      })

      const error = await new TronWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toMatchObject({
        code: LiFiErrorCode.TransactionUnprepared,
        message:
          'Unable to resume transaction. The stored signed transaction is invalid.',
      })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(true)
      expect(node.trx.sendRawTransaction).not.toHaveBeenCalled()
      expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
    })

    it('drops an invalid txHex and continues by txHash', async () => {
      const node = makeNode(accepts)
      const { context, updateAction } = makeContext(withTronNodes(node), {
        type: 'SWAP',
        txHash: TX_ID,
        txHex: 'not json',
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      // The damaged bytes are dropped before the wait, not only by the
      // confirmation write.
      const [waitOrder] = waitForTronTxConfirmation.mock.invocationCallOrder
      const clearBeforeWait = pendingWrites(updateAction).find(
        ({ params, order }) => order < waitOrder && 'txHex' in params
      )
      expect(Object.keys(clearBeforeWait?.params ?? {})).toEqual(['txHex'])
      expect(clearBeforeWait?.params.txHex).toBeUndefined()
      expect(node.trx.sendRawTransaction).not.toHaveBeenCalled()
      expect(waitForTronTxConfirmation).toHaveBeenCalledWith(
        expect.anything(),
        TX_ID
      )
    })

    describe('route stored before txHex (txHash only)', () => {
      const NOW = 1_790_000_000_000

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
      })

      it('waits by hash without resending', async () => {
        const node = makeNode(accepts)
        const { context } = makeContext(
          withTronNodes(node),
          { type: 'SWAP', txHash: TX_ID },
          { step: { execution: { signedAt: NOW - 60_000 } } }
        )

        await expect(
          new TronWaitForTransactionTask().run(context)
        ).resolves.toEqual({ status: 'COMPLETED' })
        expect(node.trx.sendRawTransaction).not.toHaveBeenCalled()
      })

      it('is dropped 20 minutes after signing when a covering node does not find it', async () => {
        const { context } = makeContext(
          withTronNodes(makeNode(accepts)),
          { type: 'SWAP', txHash: TX_ID },
          { step: { execution: { signedAt: NOW - 20 * 60_000 } } }
        )

        await expect(
          new TronWaitForTransactionTask().run(context)
        ).rejects.toMatchObject({
          code: LiFiErrorCode.TransactionExpired,
          final: true,
        })
        expect(waitForTronTxConfirmation).not.toHaveBeenCalled()
      })

      it('stays unknown when it was signed less than five minutes ago', async () => {
        const timeout = confirmationTimeout()
        waitForTronTxConfirmation.mockRejectedValue(timeout)
        const { context } = makeContext(
          withTronNodes(makeNode(accepts)),
          { type: 'SWAP', txHash: TX_ID },
          { step: { execution: { signedAt: NOW - 240_000 } } }
        )

        await expect(
          new TronWaitForTransactionTask().run(context)
        ).rejects.toBe(timeout)
      })
    })

    it('fails when neither the context nor the action carries a transaction', async () => {
      const { context } = makeContext(withTronNodes(makeNode(accepts)), {
        type: 'SWAP',
      })

      await expect(
        new TronWaitForTransactionTask().run(context)
      ).rejects.toThrow(
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    })
  })
})
