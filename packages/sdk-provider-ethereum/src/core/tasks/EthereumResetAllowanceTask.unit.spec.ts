import type { LiFiStep } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(),
}))

vi.mock('./helpers/resolveAllowanceSpender.js', () => ({
  resolveAllowanceSpender: vi.fn(),
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

import { resolveTransactionHash } from '../../actions/resolveTransactionHash.js'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'
import { resolveAllowanceSpender } from './helpers/resolveAllowanceSpender.js'

const SOURCE_CHAIN = 8453
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const APPROVAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex

const buildContext = (): EthereumStepExecutorContext =>
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
      estimate: { approvalAddress: APPROVAL_ADDRESS, approvalReset: true },
    } as unknown as LiFiStep,
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      metamask: { blockExplorerUrls: ['https://basescan.org/'] },
    },
    allowUserInteraction: true,
    calls: [],
    statusManager: {
      initializeAction: vi.fn().mockReturnValue({ type: 'RESET_ALLOWANCE' }),
      updateAction: vi.fn(),
    },
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
  }) as unknown as EthereumStepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEthereumExecutionStrategy).mockResolvedValue('standard')
  vi.mocked(resolveAllowanceSpender).mockResolvedValue({
    permit2Supported: false,
    spenderAddress: APPROVAL_ADDRESS,
  } as never)
  vi.mocked(setAllowance).mockResolvedValue(TX_HASH)
  vi.mocked(resolveTransactionHash).mockResolvedValue(TX_HASH)
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({
    transactionHash: TX_HASH,
  } as never)
})

describe('EthereumResetAllowanceTask.run', () => {
  // JUMPER-FRONT-CH. `client.chain` can be stale, so the reset names the
  // step's chain itself.
  it('sends the reset on the step chain', async () => {
    const result = await new EthereumResetAllowanceTask().run(buildContext())

    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(setAllowance).mock.calls[0][4]).toBe(0n)
    expect(vi.mocked(setAllowance).mock.calls[0][7]).toMatchObject({
      id: SOURCE_CHAIN,
    })
  })
})
