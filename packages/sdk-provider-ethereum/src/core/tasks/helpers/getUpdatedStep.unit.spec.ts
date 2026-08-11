import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFundingOrderUpdatedStep: vi.fn(),
  getStepTransaction: vi.fn(),
  getContractCallsQuote: vi.fn(),
  getRelayerQuote: vi.fn(),
}))

import {
  getContractCallsQuote,
  getFundingOrderUpdatedStep,
  getRelayerQuote,
  getStepTransaction,
  type LiFiStepExtended,
} from '@lifi/sdk'
import { getUpdatedStep } from './getUpdatedStep.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUpdatedStep — funding branch', () => {
  it('refreshes funding steps from the order, never from stepTransaction', async () => {
    const step = {
      id: 'step-1',
      fundingOrderId: 'order-1',
      includedSteps: [],
    } as unknown as LiFiStepExtended
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(step)

    await getUpdatedStep({} as any, step)

    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
  })

  it('takes precedence over the contract-calls and relayer branches', async () => {
    const step = {
      id: 'step-2',
      fundingOrderId: 'order-2',
      // Would also satisfy isContractCallStep (custom included step) and
      // isRelayerStep/isGaslessStep (non-empty typedData) — funding must win.
      includedSteps: [{ type: 'custom' }],
      typedData: [{ primaryType: 'PermitWitnessTransferFrom', message: {} }],
    } as unknown as LiFiStepExtended
    vi.mocked(getFundingOrderUpdatedStep).mockResolvedValue(step)

    await getUpdatedStep({} as any, step)

    expect(vi.mocked(getFundingOrderUpdatedStep)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStepTransaction)).not.toHaveBeenCalled()
    expect(vi.mocked(getContractCallsQuote)).not.toHaveBeenCalled()
    expect(vi.mocked(getRelayerQuote)).not.toHaveBeenCalled()
  })
})
