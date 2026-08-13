import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
  stepComparison: vi.fn(),
}))
vi.mock('./helpers/getUpdatedStep.js', () => ({
  getUpdatedStep: vi.fn(),
}))
vi.mock('../../actions/getMaxPriorityFeePerGas.js', () => ({
  getMaxPriorityFeePerGas: vi.fn(),
}))
// run() ends with getEthereumExecutionStrategy(context, true) at line 121,
// which reaches isBatchingSupported(client, { chainId: fromChain.id }). Mock it
// so these tests exercise the prepare branch, not the strategy recomputation.
vi.mock('./helpers/getEthereumExecutionStrategy.js', () => ({
  getEthereumExecutionStrategy: vi.fn(async () => 'standard'),
}))

import {
  getFundingOrderUpdatedStep,
  type LiFiStepExtended,
  stepComparison,
} from '@lifi/sdk'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'

const buildFundingStep = (
  overrides?: Partial<LiFiStepExtended>
): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    estimate: { approvalAddress: '0xApproval', skipPermit: true },
    transactionRequest: { to: '0xTo', data: '0xdata' },
    includedSteps: [],
    ...overrides,
  }) as unknown as LiFiStepExtended

const buildContext = (step: LiFiStepExtended) =>
  ({
    client: {} as any,
    step,
    executionOptions: undefined,
    statusManager: {
      findAction: vi.fn(() => ({ type: 'SWAP' })),
      updateAction: vi.fn(),
    } as any,
    allowUserInteraction: false,
    checkClient: vi.fn(),
    isBridgeExecution: false,
    signedTypedData: undefined,
    // account.type must not be 'local', or run() calls checkClient and
    // getMaxPriorityFeePerGas instead of reading the committed request.
    ethereumClient: { account: { type: 'json-rpc' } },
    fromChain: { id: 1, permit2Proxy: '0xProxy' },
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumPrepareTransactionTask — funding branch', () => {
  it('never compares rates for a funding step', async () => {
    const step = buildFundingStep()
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(stepComparison)).not.toHaveBeenCalled()
    expect(vi.mocked(getUpdatedStep)).not.toHaveBeenCalled()
  })

  it('does not refetch the order when the transactionRequest is present', async () => {
    const step = buildFundingStep()
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).not.toHaveBeenCalled()
  })

  it('restores the committed quote when the transactionRequest is missing', async () => {
    const step = buildFundingStep({ transactionRequest: undefined })
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({ transactionRequest: { to: '0xTo', data: '0xfresh' } })
    )
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(step.transactionRequest?.data).toBe('0xfresh')
    expect(vi.mocked(stepComparison)).not.toHaveBeenCalled()
  })

  it('takes the funding branch even when the step carries typedData', async () => {
    // Relocated from getUpdatedStep.unit.spec.ts. The backend rejects gasless
    // for funding orders, so this is defensive - funding must still win.
    const step = buildFundingStep({
      transactionRequest: undefined,
      typedData: [
        { primaryType: 'PermitWitnessTransferFrom', message: {} },
      ] as any,
    })
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({ transactionRequest: { to: '0xTo', data: '0xfresh' } })
    )
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getUpdatedStep)).not.toHaveBeenCalled()
  })
})

describe('EthereumPrepareTransactionTask — standard branch', () => {
  it('still refreshes and compares a non-funding step', async () => {
    const step = buildFundingStep({ fundingOrderId: undefined })
    vi.mocked(getUpdatedStep).mockResolvedValue(step)
    vi.mocked(stepComparison).mockResolvedValue(step)
    await new EthereumPrepareTransactionTask().run(buildContext(step))
    expect(vi.mocked(getUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(stepComparison)).toHaveBeenCalledTimes(1)
  })
})
