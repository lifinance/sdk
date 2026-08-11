import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getStepTransaction.js', () => ({
  getStepTransaction: vi.fn(),
}))
vi.mock('../../utils/fundingOrderStep.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
}))
vi.mock('./helpers/stepComparison.js', () => ({
  stepComparison: vi.fn(),
}))

import { getStepTransaction } from '../../actions/getStepTransaction.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { getFundingOrderUpdatedStep } from '../../utils/fundingOrderStep.js'
import { stepComparison } from './helpers/stepComparison.js'
import { PrepareTransactionTask } from './PrepareTransactionTask.js'

const buildContext = (step: LiFiStepExtended): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => ({ type: 'SWAP' })),
      updateAction: vi.fn(),
    } as any,
    isBridgeExecution: false,
    allowUserInteraction: true,
  }) as unknown as StepExecutorContext

const buildFundingStep = (
  overrides?: Partial<LiFiStepExtended>
): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    ...overrides,
  }) as unknown as LiFiStepExtended

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrepareTransactionTask — funding branch', () => {
  it('uses the stored transactionRequest without calling getStepTransaction', async () => {
    const step = buildFundingStep({
      transactionRequest: { to: '0xTo', data: '0xdata' },
    } as Partial<LiFiStepExtended>)
    const result = await new PrepareTransactionTask().run(buildContext(step))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
    expect(vi.mocked(getFundingOrderUpdatedStep)).not.toHaveBeenCalled()
  })

  it('restores a missing transactionRequest from the order, not from getStepTransaction', async () => {
    const step = buildFundingStep()
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(
      buildFundingStep({
        transactionRequest: { to: '0xTo', data: '0xdata' },
      } as Partial<LiFiStepExtended>)
    )
    const result = await new PrepareTransactionTask().run(buildContext(step))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
    expect(step.transactionRequest).toEqual({ to: '0xTo', data: '0xdata' })
  })
})

describe('PrepareTransactionTask — standard path (regression)', () => {
  it('calls getStepTransaction for standard steps without fundingOrderId', async () => {
    const step = {
      id: 'step-1',
      action: { fromChainId: 1, toChainId: 137 },
    } as unknown as LiFiStepExtended
    const updatedStep = buildFundingStep({
      transactionRequest: { to: '0xTo', data: '0x' },
    } as Partial<LiFiStepExtended>)
    vi.mocked(getStepTransaction).mockResolvedValue(updatedStep)
    vi.mocked(stepComparison).mockResolvedValue(updatedStep)

    const result = await new PrepareTransactionTask().run(buildContext(step))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getStepTransaction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(stepComparison)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getFundingOrderUpdatedStep)).not.toHaveBeenCalled()
  })
})
