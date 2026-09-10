import type { ExtendedChain, LiFiStep } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../actions/isBatchingSupported.js', () => ({
  isBatchingSupported: vi.fn(),
}))

import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getEthereumExecutionStrategy } from './getEthereumExecutionStrategy.js'

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'

const entry = (primaryType: string, spender?: string) => ({
  primaryType,
  domain: { chainId: 1, verifyingContract: PERMIT2 },
  types: {},
  message: spender ? { spender } : {},
})

const buildContext = (
  typedData?: ReturnType<typeof entry>[]
): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      tool: 'lifi',
      action: { fromChainId: 1 },
      estimate: {},
      ...(typedData ? { typedData } : {}),
    } as unknown as LiFiStep,
    fromChain: { id: 1, permit2: PERMIT2 } as unknown as ExtendedChain,
    client: {},
    ethereumClient: {},
    checkClient: vi.fn().mockResolvedValue({}),
  }) as unknown as EthereumStepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isBatchingSupported).mockResolvedValue(false)
})

describe('getEthereumExecutionStrategy', () => {
  it('relays a gasless witness step', async () => {
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('PermitWitnessTransferFrom')])
    )
    expect(strategy).toBe('relayed')
  })

  it('relays an Order step, which carries no transactionRequest', async () => {
    // Regression guard for CowSwap, 1inch Fusion and Velora Delta. Routing an
    // Order step to `standard` makes EthereumStandardSignAndExecuteTask throw
    // TransactionUnprepared, because there is no transaction to send.
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('Order')])
    )
    expect(strategy).toBe('relayed')
  })

  it('executes a caller-supplied PermitSingle step as standard', async () => {
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('PermitSingle', UNIVERSAL_ROUTER)])
    )
    expect(strategy).toBe('standard')
  })

  it('executes a native-permit-only step as standard', async () => {
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('Permit')])
    )
    expect(strategy).toBe('standard')
  })

  it('batches a caller-intent step when the wallet supports EIP-5792', async () => {
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('PermitSingle', UNIVERSAL_ROUTER)])
    )
    expect(strategy).toBe('batched')
  })

  it('leaves a step with no typed data on the batching probe', async () => {
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    expect(await getEthereumExecutionStrategy(buildContext())).toBe('batched')
  })

  it('returns the memoized strategy without recomputing', async () => {
    const context = buildContext([entry('Order')])
    context.executionStrategy = 'standard'
    expect(await getEthereumExecutionStrategy(context)).toBe('standard')
    expect(isBatchingSupported).not.toHaveBeenCalled()
  })

  it('recomputes when forceRecalculate is set', async () => {
    const context = buildContext([entry('Order')])
    context.executionStrategy = 'standard'
    expect(await getEthereumExecutionStrategy(context, true)).toBe('relayed')
  })
})
