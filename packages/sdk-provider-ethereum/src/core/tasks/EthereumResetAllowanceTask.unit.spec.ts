import type { LiFiStep } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/setAllowance.js', () => ({
  setAllowance: vi.fn(),
}))

vi.mock('../../actions/resolveTransactionHash.js', () => ({
  resolveTransactionHash: vi.fn(),
}))

vi.mock('../../actions/waitForTransactionReceipt.js', () => ({
  waitForTransactionReceipt: vi.fn(),
}))

vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(),
}))

vi.mock('./helpers/resolveAllowanceSpender.js', () => ({
  resolveAllowanceSpender: vi.fn(),
}))

import { resolveTransactionHash } from '../../actions/resolveTransactionHash.js'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'
import { resolveAllowanceSpender } from './helpers/resolveAllowanceSpender.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const APPROVAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex
const SAFE_SIGNATURE = `0x${'cd'.repeat(65)}` as Hex

const buildContext = (): EthereumStepExecutorContext =>
  ({
    step: {
      id: 'step-1',
      action: {
        fromChainId: SOURCE_CHAIN,
        fromAddress: FROM_ADDRESS,
        fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      },
      estimate: { approvalAddress: APPROVAL_ADDRESS, approvalReset: true },
    } as unknown as LiFiStep,
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      metamask: { blockExplorerUrls: ['https://etherscan.io/'] },
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

const task = new EthereumResetAllowanceTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEthereumExecutionStrategy).mockResolvedValue('standard')
  vi.mocked(resolveAllowanceSpender).mockResolvedValue({
    permit2Supported: false,
    spenderAddress: APPROVAL_ADDRESS,
  })
  vi.mocked(resolveTransactionHash).mockResolvedValue(TX_HASH)
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({
    transactionHash: TX_HASH,
  } as never)
})

describe('EthereumResetAllowanceTask.run', () => {
  // A Safe signer queues the reset and the wallet returns a 65-byte
  // signature. Only the hash that `resolveTransactionHash` finds after the
  // Safe runs it has a receipt.
  it('waits for the receipt of the resolved hash, not the Safe signature', async () => {
    vi.mocked(setAllowance).mockResolvedValue(SAFE_SIGNATURE)

    await task.run(buildContext())

    expect(resolveTransactionHash).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      SAFE_SIGNATURE,
      SOURCE_CHAIN
    )
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ txHash: TX_HASH })
    )
  })
})
