import {
  type ExecutionAction,
  getTransactionRequestData,
  isFinalTransactionError,
  LiFiErrorCode,
} from '@lifi/sdk'
import { Psbt } from 'bitcoinjs-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return { ...actual, getTransactionRequestData: vi.fn() }
})

vi.mock('@bigmi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bigmi/core')>()
  return {
    ...actual,
    signPsbt: vi.fn(),
    withTimeout: vi.fn((fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock('../../utils/isPsbtFinalized.js', () => ({
  isPsbtFinalized: vi.fn(() => true),
}))

import { signPsbt, TransactionNotFoundError } from '@bigmi/core'
import type { BitcoinStepExecutorContext } from '../../types.js'
import { BitcoinSignAndExecuteTask } from './BitcoinSignAndExecuteTask.js'
import {
  allTransportsFailed,
  DECODE_FAILED,
  httpError,
  NO_SUCH_TRANSACTION,
  rpcError,
  timeoutError,
} from './bitcoinRpcErrors.unit.mock.js'
import { MEMPOOL_STATE_REJECT_REASONS } from './classifyBitcoinSendFailure.js'

const SENDER = 'bc1qsender'
const TX_ID = 'ab'.repeat(32)
const TX_HEX = '0200000000010100'
const NOW = 1_800_000_000_000
const SEND = 'sendrawtransaction'
const LOOKUP = 'getrawtransaction'
const CLEARED_KEYS = ['txHash', 'txLink', 'txHex', 'txFinal', 'taskId']

const makeContext = (
  action: ExecutionAction
): {
  context: BitcoinStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
  sendUTXOTransaction: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const sendUTXOTransaction = vi.fn().mockResolvedValue(TX_ID)
  const request = vi.fn()
  const context = {
    step: { action: { fromAddress: SENDER } },
    walletClient: { account: { address: SENDER } },
    publicClient: { sendUTXOTransaction, request },
    statusManager: {
      findAction: vi.fn().mockReturnValue(action),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://mempool.space/'] } },
    isBridgeExecution: false,
    checkClient: vi.fn(),
  } as unknown as BitcoinStepExecutorContext
  return { context, updateAction, sendUTXOTransaction, request }
}

const FRESH_ACTION: ExecutionAction = { type: 'SWAP', status: 'STARTED' }

/** Arranges the `getrawtransaction` mock of one case. */
type SetUpLookup = (request: ReturnType<typeof vi.fn>) => unknown

/** The params of the n-th `updateAction` call. */
const paramsOf = (
  updateAction: ReturnType<typeof vi.fn>,
  call: number
): Record<string, unknown> =>
  updateAction.mock.calls[call]?.[3] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTransactionRequestData).mockResolvedValue('PSBT_HEX')
  vi.mocked(signPsbt).mockResolvedValue('SIGNED_PSBT' as never)
  // An input-less PSBT keeps the signing path free of real keys.
  vi.spyOn(Psbt, 'fromHex')
    .mockReturnValueOnce({
      data: { inputs: [] },
      toHex: () => 'UNSIGNED_PSBT',
    } as unknown as Psbt)
    .mockReturnValueOnce({
      extractTransaction: () => ({ toHex: () => TX_HEX, getId: () => TX_ID }),
      finalizeAllInputs: vi.fn(),
    } as unknown as Psbt)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BitcoinSignAndExecuteTask pre-sign guard', () => {
  it.each([
    [
      'a pending hash',
      { type: 'SWAP', status: 'PENDING', txHash: TX_ID, txHex: TX_HEX },
    ],
    [
      'a FAILED hash without txFinal',
      { type: 'SWAP', status: 'FAILED', txHash: TX_ID, txHex: TX_HEX },
    ],
    ['stored bytes only', { type: 'SWAP', status: 'PENDING', txHex: TX_HEX }],
  ] as [string, ExecutionAction][])(
    'throws TransactionConflict and never opens the wallet for %s',
    async (_label, action) => {
      const { context, updateAction, sendUTXOTransaction } = makeContext(action)

      await expect(
        new BitcoinSignAndExecuteTask().run(context)
      ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
      expect(getTransactionRequestData).not.toHaveBeenCalled()
      expect(signPsbt).not.toHaveBeenCalled()
      expect(sendUTXOTransaction).not.toHaveBeenCalled()
      expect(updateAction).not.toHaveBeenCalled()
    }
  )

  it('signs again after a final outcome and clears the old transaction fields', async () => {
    const { context, updateAction } = makeContext({
      type: 'SWAP',
      status: 'FAILED',
      txHash: 'old-hash',
      txHex: 'OLD_TX_HEX',
      txFinal: true,
    })

    await new BitcoinSignAndExecuteTask().run(context)

    expect(signPsbt).toHaveBeenCalledTimes(1)
    const params = updateAction.mock.calls.find(
      ([, , status]) => status === 'PENDING'
    )?.[3] as Record<string, unknown>
    expect(Object.keys(params)).toEqual(
      expect.arrayContaining(['txHash', 'txLink', 'txHex', 'txFinal', 'taskId'])
    )
    expect(params).toMatchObject({
      txHash: TX_ID,
      txLink: `https://mempool.space/tx/${TX_ID}`,
      txHex: TX_HEX,
    })
    expect(params.txFinal).toBeUndefined()
    expect(params.taskId).toBeUndefined()
  })
})

describe('BitcoinSignAndExecuteTask write before send', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  it('writes the transaction data before it sends the bytes', async () => {
    const { context, updateAction, sendUTXOTransaction } =
      makeContext(FRESH_ACTION)

    const result = await new BitcoinSignAndExecuteTask().run(context)

    expect(updateAction).toHaveBeenCalledTimes(1)
    expect(updateAction.mock.calls[0]?.[2]).toBe('PENDING')
    const params = paramsOf(updateAction, 0)
    for (const key of ['txFinal', 'taskId']) {
      expect(key in params).toBe(true)
      expect(params[key]).toBeUndefined()
    }
    expect(params).toMatchObject({
      txHash: TX_ID,
      txLink: `https://mempool.space/tx/${TX_ID}`,
      txHex: TX_HEX,
      signedAt: NOW,
    })
    expect(sendUTXOTransaction).toHaveBeenCalledWith({ hex: TX_HEX })
    expect(updateAction.mock.invocationCallOrder[0]).toBeLessThan(
      sendUTXOTransaction.mock.invocationCallOrder[0] as number
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      context: { bitcoinSent: true },
    })
  })

  it('writes the txid the node returns when it differs from the signed one', async () => {
    const { context, updateAction, sendUTXOTransaction } =
      makeContext(FRESH_ACTION)
    const otherTxId = 'cd'.repeat(32)
    sendUTXOTransaction.mockResolvedValue(otherTxId)

    await new BitcoinSignAndExecuteTask().run(context)

    expect(updateAction).toHaveBeenCalledTimes(2)
    expect(paramsOf(updateAction, 0).txHash).toBe(TX_ID)
    expect(paramsOf(updateAction, 1)).toEqual({
      txHash: otherTxId,
      txLink: `https://mempool.space/tx/${otherTxId}`,
    })
  })

  it('writes nothing when signing fails', async () => {
    const { context, updateAction, sendUTXOTransaction } =
      makeContext(FRESH_ACTION)
    const rejection = new Error('User rejected the request.')
    vi.mocked(signPsbt).mockRejectedValue(rejection)

    await expect(new BitcoinSignAndExecuteTask().run(context)).rejects.toBe(
      rejection
    )
    expect(updateAction).not.toHaveBeenCalled()
    expect(sendUTXOTransaction).not.toHaveBeenCalled()
  })

  it.each([
    [
      'RpcRequestError',
      rpcError(SEND, DECODE_FAILED),
      rpcError(LOOKUP, NO_SUCH_TRANSACTION),
    ],
    [
      'HttpRequestError with the JSON in details',
      httpError(SEND, JSON.stringify(DECODE_FAILED)),
      httpError(LOOKUP, JSON.stringify(NO_SUCH_TRANSACTION)),
    ],
  ])(
    'clears the transaction data when every node refuses the bytes and none holds them (%s)',
    async (_label, sendFailure, lookupFailure) => {
      const { context, updateAction, sendUTXOTransaction, request } =
        makeContext(FRESH_ACTION)
      const sendError = allTransportsFailed(SEND, [sendFailure])
      sendUTXOTransaction.mockRejectedValue(sendError)
      request.mockRejectedValue(allTransportsFailed(LOOKUP, [lookupFailure]))

      const thrown = await new BitcoinSignAndExecuteTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(thrown).toBe(sendError)
      expect(isFinalTransactionError(thrown)).toBe(false)
      expect(request).toHaveBeenCalledWith({
        method: 'getrawtransaction',
        params: [TX_ID, true],
      })
      expect(updateAction).toHaveBeenCalledTimes(2)
      const cleared = paramsOf(updateAction, 1)
      for (const key of CLEARED_KEYS) {
        expect(key in cleared).toBe(true)
        expect(cleared[key]).toBeUndefined()
      }
    }
  )

  it('keeps the data and completes when a refused send is found by txid', async () => {
    const { context, updateAction, sendUTXOTransaction, request } =
      makeContext(FRESH_ACTION)
    sendUTXOTransaction.mockRejectedValue(
      allTransportsFailed(SEND, [
        rpcError(SEND, {
          code: -25,
          message: 'bad-txns-inputs-missingorspent',
        }),
      ])
    )
    request.mockResolvedValue({ txid: TX_ID, confirmations: 1 })

    const result = await new BitcoinSignAndExecuteTask().run(context)

    expect(result).toEqual({
      status: 'COMPLETED',
      context: { bitcoinSent: true },
    })
    expect(updateAction).toHaveBeenCalledTimes(1)
  })

  it('completes without a lookup when a node already has the transaction (-27)', async () => {
    const { context, updateAction, sendUTXOTransaction, request } =
      makeContext(FRESH_ACTION)
    sendUTXOTransaction.mockRejectedValue(
      allTransportsFailed(SEND, [
        rpcError(SEND, {
          code: -27,
          message: 'Transaction already in block chain',
        }),
      ])
    )

    const result = await new BitcoinSignAndExecuteTask().run(context)

    expect(result).toEqual({
      status: 'COMPLETED',
      context: { bitcoinSent: true },
    })
    expect(request).not.toHaveBeenCalled()
    expect(updateAction).toHaveBeenCalledTimes(1)
  })

  const noLookup: SetUpLookup = () => undefined
  const refusedSend = (): Error =>
    allTransportsFailed(SEND, [rpcError(SEND, DECODE_FAILED)])

  it.each<[string, SetUpLookup, Error]>([
    ['a timeout', noLookup, allTransportsFailed(SEND, [timeoutError(SEND)])],
    [
      'a timeout on one URL and a refusal on the next',
      noLookup,
      allTransportsFailed(SEND, [
        timeoutError(SEND),
        rpcError(SEND, DECODE_FAILED),
      ]),
    ],
    [
      'a lookup error after a refusal',
      (request) =>
        request.mockRejectedValue(
          allTransportsFailed(LOOKUP, [timeoutError(LOOKUP)])
        ),
      refusedSend(),
    ],
    [
      'a TransactionNotFoundError from the lookup',
      (request) =>
        request.mockRejectedValue(
          new TransactionNotFoundError({ hash: `0x${TX_ID}` })
        ),
      refusedSend(),
    ],
    [
      'a null lookup result',
      (request) => request.mockResolvedValue(null),
      refusedSend(),
    ],
    ...MEMPOOL_STATE_REJECT_REASONS.map(
      (reason): [string, SetUpLookup, Error] => [
        `the one-node mempool reason "${reason}"`,
        noLookup,
        allTransportsFailed(SEND, [
          rpcError(SEND, { code: -26, message: reason }),
        ]),
      ]
    ),
  ])(
    'keeps the data and rethrows non-final for %s',
    async (_label, setUpLookup, sendError) => {
      const { context, updateAction, sendUTXOTransaction, request } =
        makeContext(FRESH_ACTION)
      sendUTXOTransaction.mockRejectedValue(sendError)
      setUpLookup(request)

      const thrown = await new BitcoinSignAndExecuteTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(thrown).toBe(sendError)
      expect(isFinalTransactionError(thrown)).toBe(false)
      expect(updateAction).toHaveBeenCalledTimes(1)
      expect(paramsOf(updateAction, 0)).toMatchObject({
        txHash: TX_ID,
        txHex: TX_HEX,
      })
    }
  )
})
