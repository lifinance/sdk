import type { ExecutionType, ExtendedChain, LiFiStep } from '@lifi/sdk'
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
  typedData?: ReturnType<typeof entry>[],
  executionType?: ExecutionType,
  withTransactionRequest?: boolean
): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      tool: 'lifi',
      action: { fromChainId: 1 },
      estimate: {},
      ...(typedData ? { typedData } : {}),
      ...(executionType ? { executionType } : {}),
      ...(withTransactionRequest
        ? { transactionRequest: { to: UNIVERSAL_ROUTER, data: '0xdeadbeef' } }
        : {}),
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
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('Order')])
    )
    expect(strategy).toBe('relayed')
  })

  it('relays a mixed-lane step carrying both a witness and a Permit2 allowance', async () => {
    const strategy = await getEthereumExecutionStrategy(
      buildContext([
        entry('PermitWitnessTransferFrom'),
        entry('PermitSingle', UNIVERSAL_ROUTER),
      ])
    )
    expect(strategy).toBe('relayed')
  })

  it('executes a caller-supplied PermitSingle step as standard', async () => {
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('PermitSingle', UNIVERSAL_ROUTER)])
    )
    expect(strategy).toBe('standard')
  })

  // JUMEMB-88: a native permit must keep the baseline's `relayed` verdict. If it
  // resolves `batched`, the allowance tasks queue the approve, prepare flips the
  // strategy to `relayed`, and the queued approve is silently discarded.
  it('relays a native-permit-only step, as the baseline did', async () => {
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('Permit')])
    )
    expect(strategy).toBe('relayed')
    expect(isBatchingSupported).not.toHaveBeenCalled()
  })

  it('relays a native-permit-only step whose permit is never signed', async () => {
    // `disableMessageSigning` leaves `hasMatchingPermit` false, which is how the
    // step reached the allowance tasks with a batch-capable wallet in JUMEMB-88.
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const context = buildContext([entry('Permit')])
    context.disableMessageSigning = true
    expect(await getEthereumExecutionStrategy(context)).toBe('relayed')
  })

  it('relays a step the backend declared a message before its typed data arrives', async () => {
    // Hyperliquid carries `executionType: 'message'` from routes time, but
    // `typedData` only arrives at /advanced/stepTransaction (JUMEMB-102).
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const strategy = await getEthereumExecutionStrategy(
      buildContext(undefined, 'message')
    )
    expect(strategy).toBe('relayed')
    expect(isBatchingSupported).not.toHaveBeenCalled()
  })

  it('leaves a transaction-type step with no typed data on the batching probe', async () => {
    vi.mocked(isBatchingSupported).mockResolvedValue(true)
    const strategy = await getEthereumExecutionStrategy(
      buildContext(undefined, 'transaction')
    )
    expect(strategy).toBe('batched')
    expect(isBatchingSupported).toHaveBeenCalledTimes(1)
  })

  it('relays a gasless step through the typed data, not its executionType', async () => {
    // The gasless lane reports `executionType: 'transaction'` by design while
    // being signature-only, so it depends entirely on the typed-data inference.
    const strategy = await getEthereumExecutionStrategy(
      buildContext([entry('PermitWitnessTransferFrom')], 'transaction')
    )
    expect(strategy).toBe('relayed')
  })

  it('batches a Permit2 allowance step when the wallet supports EIP-5792', async () => {
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

  it('recomputes when afterPrepare is set', async () => {
    const context = buildContext([entry('Order')])
    context.executionStrategy = 'standard'
    expect(await getEthereumExecutionStrategy(context, true)).toBe('relayed')
  })

  // The two shapes below are the same step before and after prepare. Only the
  // second one knows whether a transaction ever arrives, which is why the rule
  // is bound to `afterPrepare` and not applied on sight.
  describe('a Permit2 allowance that never receives a transaction', () => {
    it('relays it once prepare has answered without one', async () => {
      vi.mocked(isBatchingSupported).mockResolvedValue(true)
      const context = buildContext([entry('PermitSingle', UNIVERSAL_ROUTER)])

      expect(await getEthereumExecutionStrategy(context, true)).toBe('relayed')
    })

    it('keeps batching before prepare, when the answer is still unknown', async () => {
      vi.mocked(isBatchingSupported).mockResolvedValue(true)
      const context = buildContext([entry('PermitSingle', UNIVERSAL_ROUTER)])

      // Calling it relayed here would cost `EthereumSetAllowanceTask` its
      // EIP-5792 batch for every Permit2 allowance that does receive a transaction.
      expect(await getEthereumExecutionStrategy(context)).toBe('batched')
    })

    it('leaves a Permit2 allowance that did receive one on the batching probe', async () => {
      vi.mocked(isBatchingSupported).mockResolvedValue(true)
      const context = buildContext(
        [entry('PermitSingle', UNIVERSAL_ROUTER)],
        undefined,
        true
      )

      expect(await getEthereumExecutionStrategy(context, true)).toBe('batched')
    })

    it('does not relay a step that has neither typed data nor a transaction', async () => {
      vi.mocked(isBatchingSupported).mockResolvedValue(false)

      expect(await getEthereumExecutionStrategy(buildContext(), true)).toBe(
        'standard'
      )
    })
  })
})
