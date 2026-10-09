import {
  CLEARED_TRANSACTION_FIELDS,
  LiFiErrorCode,
  type LiFiStep,
} from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Call, EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedSignAndExecuteTask } from './EthereumBatchedSignAndExecuteTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address
const BATCH_ID = `0x${'ba'.repeat(32)}` as Hex
const SIGNED_AT = 1_700_000_000_000

/** The approval that `EthereumSetAllowanceTask` queues on the batched lane. */
const APPROVE_CALL: Call = {
  chainId: SOURCE_CHAIN,
  to: TOKEN,
  data: '0x095ea7b3',
}

const buildContext = (
  calls: Call[] = []
): {
  context: EthereumStepExecutorContext
  sendCalls: ReturnType<typeof vi.fn>
} => {
  // `getAction` prefers a method of the same name on the client.
  const sendCalls = vi.fn().mockResolvedValue({ id: BATCH_ID })
  const context = {
    step: {
      type: 'lifi',
      id: 'step-1',
      tool: 'lifi',
      action: { fromChainId: SOURCE_CHAIN, fromAddress: FROM_ADDRESS },
    } as unknown as LiFiStep,
    fromChain: { id: SOURCE_CHAIN },
    isBridgeExecution: false,
    statusManager: {
      findAction: vi.fn().mockReturnValue({ type: 'SWAP' }),
      updateAction: vi.fn(),
    },
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
      sendCalls,
    }),
    transactionRequest: { to: ROUTER, data: '0xdeadbeef', value: 0n },
    calls,
  } as unknown as EthereumStepExecutorContext
  return { context, sendCalls }
}

describe('EthereumBatchedSignAndExecuteTask.run', () => {
  it('clears the previous transaction fields when it writes the batch id', async () => {
    const { context, sendCalls } = buildContext()

    const result = await new EthereumBatchedSignAndExecuteTask().run(context)

    expect(result.status).toBe('COMPLETED')
    expect(sendCalls).toHaveBeenCalledTimes(1)
    const params = vi
      .mocked(context.statusManager.updateAction)
      .mock.calls.find(([, , status]) => status === 'PENDING')?.[3]
    expect(Object.keys(params ?? {})).toEqual(
      expect.arrayContaining(['txHash', 'txLink', 'txHex', 'txFinal'])
    )
    expect(params).toMatchObject({ taskId: BATCH_ID, txType: 'batched' })
    expect(params?.txHash).toBeUndefined()
    expect(params?.txFinal).toBeUndefined()
  })
})

// The batched wait reads the call count to decide if a bundle the wallet
// lost was sent. It must be the length of the array sent to the wallet.
describe('EthereumBatchedSignAndExecuteTask.run call count', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { bundle: 'a swap only', calls: [], callCount: 1 },
    {
      bundle: 'an approval and a swap',
      calls: [APPROVE_CALL],
      callCount: 2,
    },
  ])(
    'writes the call count of $bundle with the batch id',
    async ({ calls, callCount }) => {
      vi.spyOn(Date, 'now').mockReturnValue(SIGNED_AT)
      const { context, sendCalls } = buildContext(calls)

      await new EthereumBatchedSignAndExecuteTask().run(context)

      expect(sendCalls).toHaveBeenCalledTimes(1)
      expect(sendCalls.mock.calls[0][0].calls).toHaveLength(callCount)
      expect(context.statusManager.updateAction).toHaveBeenCalledTimes(1)
      const [, type, status, fields] = vi.mocked(
        context.statusManager.updateAction
      ).mock.calls[0]
      expect([type, status]).toEqual(['SWAP', 'PENDING'])
      // Strict: a missing key would keep the count of an earlier bundle.
      expect(fields).toStrictEqual({
        ...CLEARED_TRANSACTION_FIELDS,
        taskId: BATCH_ID,
        txType: 'batched',
        callCount,
        signedAt: SIGNED_AT,
      })
    }
  )
})

describe('EthereumBatchedSignAndExecuteTask.run second pre-sign guard', () => {
  // An older run's late write can merge its transaction into this action
  // while the chain is checked.
  it('checks the action again right before sendCalls and never calls it when a transaction merged meanwhile', async () => {
    const { context, sendCalls } = buildContext()
    vi.mocked(context.checkClient).mockImplementationOnce(async () => {
      vi.mocked(context.statusManager.findAction).mockReturnValue({
        type: 'SWAP',
        status: 'ACTION_REQUIRED',
        taskId: `0x${'01'.repeat(32)}`,
      } as never)
      return { account: { address: FROM_ADDRESS }, sendCalls } as never
    })

    await expect(
      new EthereumBatchedSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
    expect(context.checkClient).toHaveBeenCalledTimes(1)
    expect(sendCalls).not.toHaveBeenCalled()
    expect(context.statusManager.updateAction).not.toHaveBeenCalled()
  })
})
