import type { LiFiStep, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/isBatchingSupported.js', () => ({
  isBatchingSupported: vi.fn(),
}))

vi.mock('../../actions/setAllowance.js', () => ({
  setAllowance: vi.fn(),
}))

vi.mock('../../actions/resolveTransactionHash.js', () => ({
  resolveTransactionHash: vi.fn(),
}))

vi.mock('../../actions/waitForTransactionReceipt.js', () => ({
  waitForTransactionReceipt: vi.fn(),
}))

vi.mock('../../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))

import { isBatchingSupported } from '../../actions/isBatchingSupported.js'
import { resolveTransactionHash } from '../../actions/resolveTransactionHash.js'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import { canAccountUsePermit2 } from '../../permits/canAccountUsePermit2.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const APPROVAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const APPROVE_DATA = '0x095ea7b3' as Hex
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex

const nativePermit = (): TypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: TOKEN_ADDRESS },
    types: {},
    message: { spender: PERMIT2_PROXY },
  }) as unknown as TypedData

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const buildContext = (options: {
  typedData: TypedData[]
  disableMessageSigning?: boolean
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
      typedData: options.typedData,
    } as unknown as LiFiStep,
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: PERMIT2,
      permit2Proxy: PERMIT2_PROXY,
      metamask: { blockExplorerUrls: ['https://etherscan.io/'] },
    },
    isFromNativeToken: false,
    disableMessageSigning: options.disableMessageSigning ?? false,
    isBridgeExecution: false,
    allowUserInteraction: true,
    signedTypedData: [],
    calls: [],
    statusManager: {
      initializeAction: vi.fn().mockReturnValue({ type: 'SET_ALLOWANCE' }),
      updateAction: vi.fn(),
    },
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    ethereumClient: { account: { address: FROM_ADDRESS } },
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumSetAllowanceTask()

/** The `returnPopulatedTransaction` argument — true means "queue into the batch". */
const queuedIntoBatch = () =>
  vi.mocked(setAllowance).mock.calls[0][6] as boolean | undefined

beforeEach(() => {
  vi.clearAllMocks()
  // A batch-capable wallet is what turns a wrong strategy into a lost approve.
  vi.mocked(isBatchingSupported).mockResolvedValue(true)
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
  vi.mocked(setAllowance).mockResolvedValue(APPROVE_DATA)
  vi.mocked(resolveTransactionHash).mockResolvedValue(TX_HASH)
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({
    transactionHash: TX_HASH,
  } as never)
})

describe('EthereumSetAllowanceTask.run', () => {
  // JUMEMB-88. `disableMessageSigning` leaves `hasMatchingPermit` false, so a
  // native-permit step reaches this task. If the strategy is `batched` the
  // approve is queued, prepare then flips the strategy to `relayed`, and the
  // queued approve is discarded — with no retry that heals it.
  it('sends the approve for a native-permit step instead of queueing it', async () => {
    const context = buildContext({
      typedData: [nativePermit()],
      disableMessageSigning: true,
    })

    const result = await task.run(context)

    expect(result.context?.executionStrategy).toBe('relayed')
    expect(queuedIntoBatch()).toBe(false)
    expect(result.context?.calls).toHaveLength(0)
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1)
  })

  it('still queues the approve for a caller-intent step the wallet can batch', async () => {
    const context = buildContext({ typedData: [callerIntent()] })

    const result = await task.run(context)

    expect(result.context?.executionStrategy).toBe('batched')
    expect(queuedIntoBatch()).toBe(true)
    expect(result.context?.calls).toHaveLength(1)
    expect(waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('approves the step approval address, not Permit2, for a relayed native permit', async () => {
    const context = buildContext({
      typedData: [nativePermit()],
      disableMessageSigning: true,
    })

    await task.run(context)

    expect(vi.mocked(setAllowance).mock.calls[0][3]).toBe(APPROVAL_ADDRESS)
  })
})
