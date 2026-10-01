import type { LiFiStep } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedSignAndExecuteTask } from './EthereumBatchedSignAndExecuteTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const BATCH_ID = `0x${'ba'.repeat(32)}` as Hex

const buildContext = (): {
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
    calls: [],
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
