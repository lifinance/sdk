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
  request: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  lookup: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  /** The answer to `sendrawtransaction`. */
  const send = vi.fn().mockResolvedValue(TX_ID)
  /** The answer to `getrawtransaction`. */
  const lookup = vi.fn()
  const request = vi.fn((args: { method: string; params: unknown[] }) =>
    args.method === SEND ? send(args) : lookup(args)
  )
  const context = {
    step: { action: { fromAddress: SENDER } },
    walletClient: { account: { address: SENDER } },
    publicClient: {
      request,
      // As in bigmi: `request` without options, so the fallback retries
      // the whole round.
      sendUTXOTransaction: ({ hex }: { hex: string }) =>
        request({ method: SEND, params: [hex] }),
    },
    statusManager: {
      findAction: vi.fn().mockReturnValue(action),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://mempool.space/'] } },
    isBridgeExecution: false,
    checkClient: vi.fn(),
  } as unknown as BitcoinStepExecutorContext
  return { context, updateAction, request, send, lookup }
}

const FRESH_ACTION: ExecutionAction = { type: 'SWAP', status: 'STARTED' }

/** Arranges the `getrawtransaction` answer of one case. */
type SetUpLookup = (lookup: ReturnType<typeof vi.fn>) => unknown

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
      const { context, updateAction, request } = makeContext(action)

      await expect(
        new BitcoinSignAndExecuteTask().run(context)
      ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
      expect(getTransactionRequestData).not.toHaveBeenCalled()
      expect(signPsbt).not.toHaveBeenCalled()
      expect(request).not.toHaveBeenCalled()
      expect(updateAction).not.toHaveBeenCalled()
    }
  )

  // An older run's late write can merge its transaction into this action
  // while the task awaits the quote (spec addendum §5.2 case 1).
  it('checks the action again right before the wallet and never opens it when a transaction merged meanwhile', async () => {
    const { context, updateAction, request } = makeContext(FRESH_ACTION)
    vi.mocked(getTransactionRequestData).mockImplementationOnce(async () => {
      vi.mocked(context.statusManager.findAction).mockReturnValue({
        type: 'SWAP',
        status: 'STARTED',
        txHash: TX_ID,
        txHex: TX_HEX,
      })
      return 'PSBT_HEX'
    })

    await expect(
      new BitcoinSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
    expect(getTransactionRequestData).toHaveBeenCalledTimes(1)
    expect(signPsbt).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

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
    const { context, updateAction, send } = makeContext(FRESH_ACTION)

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
    expect(send).toHaveBeenCalledWith({ method: SEND, params: [TX_HEX] })
    expect(updateAction.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] as number
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      context: { bitcoinSent: true },
    })
  })

  // bigmi's fallback retries a failed round up to 3 times, and its error
  // keeps only the last round. An earlier round may have reached a node
  // that accepted the bytes.
  it('sends the bytes in one round, without the fallback retries', async () => {
    const { context, request } = makeContext(FRESH_ACTION)

    await new BitcoinSignAndExecuteTask().run(context)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      { method: SEND, params: [TX_HEX] },
      { retryCount: 0 }
    )
  })

  it('writes the txid the node returns when it differs from the signed one', async () => {
    const { context, updateAction, send } = makeContext(FRESH_ACTION)
    const otherTxId = 'cd'.repeat(32)
    send.mockResolvedValue(otherTxId)

    await new BitcoinSignAndExecuteTask().run(context)

    expect(updateAction).toHaveBeenCalledTimes(2)
    expect(paramsOf(updateAction, 0).txHash).toBe(TX_ID)
    expect(paramsOf(updateAction, 1)).toStrictEqual({
      txHash: otherTxId,
      txLink: `https://mempool.space/tx/${otherTxId}`,
    })
  })

  it.each([
    ['null', null],
    ['an empty string', ''],
  ])(
    'keeps the signed txid when the node returns %s',
    async (_label, answer) => {
      const { context, updateAction, send } = makeContext(FRESH_ACTION)
      send.mockResolvedValue(answer)

      const result = await new BitcoinSignAndExecuteTask().run(context)

      expect(updateAction).toHaveBeenCalledTimes(1)
      expect(paramsOf(updateAction, 0).txHash).toBe(TX_ID)
      expect(result).toEqual({
        status: 'COMPLETED',
        context: { bitcoinSent: true },
      })
    }
  )

  it('writes nothing when signing fails', async () => {
    const { context, updateAction, request } = makeContext(FRESH_ACTION)
    const rejection = new Error('User rejected the request.')
    vi.mocked(signPsbt).mockRejectedValue(rejection)

    await expect(new BitcoinSignAndExecuteTask().run(context)).rejects.toBe(
      rejection
    )
    expect(updateAction).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
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
      const { context, updateAction, request, send, lookup } =
        makeContext(FRESH_ACTION)
      const sendError = allTransportsFailed(SEND, [sendFailure])
      send.mockRejectedValue(sendError)
      lookup.mockRejectedValue(allTransportsFailed(LOOKUP, [lookupFailure]))

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
    const { context, updateAction, request, send, lookup } =
      makeContext(FRESH_ACTION)
    send.mockRejectedValue(
      allTransportsFailed(SEND, [
        rpcError(SEND, {
          code: -25,
          message: 'bad-txns-inputs-missingorspent',
        }),
      ])
    )
    lookup.mockResolvedValue({ txid: TX_ID, confirmations: 1 })

    const result = await new BitcoinSignAndExecuteTask().run(context)

    expect(result).toEqual({
      status: 'COMPLETED',
      context: { bitcoinSent: true },
    })
    expect(request).toHaveBeenCalledWith({
      method: 'getrawtransaction',
      params: [TX_ID, true],
    })
    expect(updateAction).toHaveBeenCalledTimes(1)
  })

  it('completes without a lookup when a node already has the transaction (-27)', async () => {
    const { context, updateAction, send, lookup } = makeContext(FRESH_ACTION)
    send.mockRejectedValue(
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
    expect(lookup).not.toHaveBeenCalled()
    expect(updateAction).toHaveBeenCalledTimes(1)
  })

  /**
   * For a send failure that must not reach the lookup: the lookup would
   * answer -5 from every URL and clear the data.
   */
  const absentIfLookedUp: SetUpLookup = (lookup) =>
    lookup.mockRejectedValue(
      allTransportsFailed(LOOKUP, [rpcError(LOOKUP, NO_SUCH_TRANSACTION)])
    )
  const refusedSend = (): Error =>
    allTransportsFailed(SEND, [rpcError(SEND, DECODE_FAILED)])

  it.each<[string, SetUpLookup, Error, number]>([
    [
      'a timeout',
      absentIfLookedUp,
      allTransportsFailed(SEND, [timeoutError(SEND)]),
      0,
    ],
    [
      'a timeout on one URL and a refusal on the next',
      absentIfLookedUp,
      allTransportsFailed(SEND, [
        timeoutError(SEND),
        rpcError(SEND, DECODE_FAILED),
      ]),
      0,
    ],
    [
      'a lookup error after a refusal',
      (lookup) =>
        lookup.mockRejectedValue(
          allTransportsFailed(LOOKUP, [timeoutError(LOOKUP)])
        ),
      refusedSend(),
      1,
    ],
    [
      'a TransactionNotFoundError from the lookup',
      (lookup) =>
        lookup.mockRejectedValue(
          new TransactionNotFoundError({ hash: `0x${TX_ID}` })
        ),
      refusedSend(),
      1,
    ],
    [
      'a null lookup result',
      (lookup) => lookup.mockResolvedValue(null),
      refusedSend(),
      1,
    ],
    ...MEMPOOL_STATE_REJECT_REASONS.map(
      (reason): [string, SetUpLookup, Error, number] => [
        `the one-node mempool reason "${reason}"`,
        absentIfLookedUp,
        allTransportsFailed(SEND, [
          rpcError(SEND, { code: -26, message: reason }),
        ]),
        0,
      ]
    ),
  ])(
    'keeps the data and rethrows non-final for %s',
    async (_label, setUpLookup, sendError, lookups) => {
      const { context, updateAction, send, lookup } = makeContext(FRESH_ACTION)
      send.mockRejectedValue(sendError)
      setUpLookup(lookup)

      const thrown = await new BitcoinSignAndExecuteTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(thrown).toBe(sendError)
      expect(isFinalTransactionError(thrown)).toBe(false)
      expect(lookup).toHaveBeenCalledTimes(lookups)
      expect(updateAction).toHaveBeenCalledTimes(1)
      expect(paramsOf(updateAction, 0)).toMatchObject({
        txHash: TX_ID,
        txHex: TX_HEX,
      })
    }
  )
})
