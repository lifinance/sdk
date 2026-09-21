import {
  LiFiErrorCode,
  type LiFiStep,
  type TransactionMethodType,
  type TypedData,
} from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { relayedRun, batchedRun } = vi.hoisted(() => ({
  relayedRun: vi.fn(),
  batchedRun: vi.fn(),
}))

vi.mock('./EthereumRelayedSignAndExecuteTask.js', () => ({
  EthereumRelayedSignAndExecuteTask: class {
    run = relayedRun
  },
}))

vi.mock('./EthereumBatchedSignAndExecuteTask.js', () => ({
  EthereumBatchedSignAndExecuteTask: class {
    run = batchedRun
  },
}))

vi.mock('../../actions/isBatchingSupported.js', () => ({
  isBatchingSupported: vi.fn(),
}))

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return { ...actual, sendTransaction: vi.fn() }
})

vi.mock('../../actions/resolveTransactionHash.js', () => ({
  resolveTransactionHash: vi.fn(),
}))

vi.mock('../../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))

import { sendTransaction } from 'viem/actions'
import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import { resolveTransactionHash } from '../../actions/resolveTransactionHash.js'
import { canAccountUsePermit2 } from '../../permits/canAccountUsePermit2.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumSignAndExecuteTask } from './EthereumSignAndExecuteTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const APPROVAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const ROUTER_CALLDATA = '0xdeadbeef' as Hex
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex

/**
 * A Permit2 allowance is the shape that matters here: it is the only typed data
 * that does NOT resolve to `relayed` on sight, so the lane it lands in depends
 * on the verdict `EthereumPrepareTransactionTask` stored.
 */
const permit2Allowance = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const buildContext = (options: {
  typedData?: TypedData[]
  withTransactionRequest: boolean
  executionStrategy?: TransactionMethodType
}): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      tool: 'uniswap',
      action: {
        fromChainId: SOURCE_CHAIN,
        fromAddress: FROM_ADDRESS,
        fromAmount: '1000000',
        fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      },
      estimate: {
        approvalAddress: APPROVAL_ADDRESS,
        gasCosts: [],
        feeCosts: [],
      },
      ...(options.typedData ? { typedData: options.typedData } : {}),
    } as unknown as LiFiStep,
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: PERMIT2,
      permit2Proxy: PERMIT2_PROXY,
      metamask: { blockExplorerUrls: ['https://etherscan.io/'] },
    },
    ...(options.executionStrategy
      ? { executionStrategy: options.executionStrategy }
      : {}),
    isFromNativeToken: false,
    disableMessageSigning: false,
    isBridgeExecution: false,
    allowUserInteraction: true,
    signedTypedData: [],
    calls: [],
    statusManager: {
      findAction: vi.fn().mockReturnValue({ type: 'SWAP' }),
      updateAction: vi.fn(),
    },
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    ethereumClient: { account: { address: FROM_ADDRESS } },
    ...(options.withTransactionRequest
      ? {
          transactionRequest: {
            chainId: SOURCE_CHAIN,
            from: FROM_ADDRESS,
            to: UNIVERSAL_ROUTER,
            data: ROUTER_CALLDATA,
          },
        }
      : {}),
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumSignAndExecuteTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isBatchingSupported).mockResolvedValue(false)
  vi.mocked(relayedRun).mockResolvedValue({ status: 'COMPLETED' })
  vi.mocked(batchedRun).mockResolvedValue({ status: 'COMPLETED' })
  vi.mocked(sendTransaction).mockResolvedValue(TX_HASH)
  vi.mocked(resolveTransactionHash).mockResolvedValue(TX_HASH)
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
})

describe('EthereumSignAndExecuteTask.run', () => {
  // This task dispatches, it does not classify. `getEthereumExecutionStrategy`
  // owns the lane, and `EthereumPrepareTransactionTask` stores its verdict —
  // which is what also reaches `EthereumWaitForTransactionTask`. Deciding the
  // lane here instead would send the signature down the relayed path and then
  // wait for it on the standard one.
  it('follows the stored relayed verdict for a step with nothing to send', async () => {
    const context = buildContext({
      typedData: [permit2Allowance()],
      withTransactionRequest: false,
      executionStrategy: 'relayed',
    })

    const result = await task.run(context)

    expect(result.status).toBe('COMPLETED')
    expect(relayedRun).toHaveBeenCalledTimes(1)
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('does not batch that step, even where the wallet supports batching', async () => {
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const context = buildContext({
      typedData: [permit2Allowance()],
      withTransactionRequest: false,
      executionStrategy: 'relayed',
    })

    await task.run(context)

    expect(relayedRun).toHaveBeenCalledTimes(1)
    expect(batchedRun).not.toHaveBeenCalled()
  })

  it('leaves a Permit2 allowance step that did receive a transaction on the standard task', async () => {
    const context = buildContext({
      typedData: [permit2Allowance()],
      withTransactionRequest: true,
    })

    await task.run(context)

    expect(relayedRun).not.toHaveBeenCalled()
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: UNIVERSAL_ROUTER, data: ROUTER_CALLDATA })
    )
  })

  it('still throws TransactionUnprepared when there is no typed data either', async () => {
    // The rule must not swallow a genuine unprepared-transaction error.
    const context = buildContext({ withTransactionRequest: false })

    await expect(task.run(context)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
    })
    expect(relayedRun).not.toHaveBeenCalled()
  })
})
