import { Chain, LifiStep, Route } from '@lifi/types'
import { Signer } from 'ethers'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRouteObject, buildStepObject } from '../../test/fixtures'
import { StatusManager } from '../execution'
import { InternalExecutionSettings } from '../types'
import { checkAllowance } from './checkAllowance'

import * as allowance from '../allowance/utils'

vi.mock('../allowance/utils', () => ({
  getApproved: vi.fn(() => Promise.resolve({})),
}))

const mockedApprovedAllowance = vi.spyOn(allowance, 'getApproved')

let signer: Signer
let statusManager: StatusManager
const updateRouteHookMock: Mock = vi.fn()
const internalUpdateRouteHookMock: Mock = vi.fn()
let route: Route
let step: LifiStep
let chain: Chain
const mockSettings: InternalExecutionSettings = {
  updateRouteHook: updateRouteHookMock,
  switchChainHook: () => Promise.resolve(undefined),
  acceptExchangeRateUpdateHook: () => Promise.resolve(undefined),
  infiniteApproval: false,
  executeInBackground: false,
}

const mockStep = buildStepObject({})
const initializeStatusManager = ({
  includingExecution,
}: {
  includingExecution: boolean
}): StatusManager => {
  step = buildStepObject({ includingExecution })
  route = buildRouteObject({ step })

  return new StatusManager(
    structuredClone(route),
    {
      ...mockSettings,
    },
    internalUpdateRouteHookMock
  )
}

describe('parseError', () => {
  beforeEach(() => {
    statusManager = initializeStatusManager({ includingExecution: false })
    statusManager.initExecutionObject(mockStep)
  })

  it('should consider gas config settings passed by developer', async () => {
    const currentSettings: InternalExecutionSettings = {
      ...mockSettings,
      updateTransactionRequestHook: async (txRequest) => {
        return {
          ...txRequest,
          gasLimit: 100000,
          gasPrice: 1000000000,
        }
      },
    }

    await checkAllowance(
      signer,
      mockStep,
      statusManager,
      currentSettings,
      chain
    )

    expect(mockedApprovedAllowance).toBeCalledWith(
      signer,
      mockStep.action.fromToken.address,
      mockStep.estimate.approvalAddress,
      {
        from: mockStep.action.fromToken.address,
        gasLimit: 100000,
        gasPrice: 1000000000,
        to: mockStep.estimate.approvalAddress,
      }
    )
  })

  it('should continue without any config', async () => {
    await checkAllowance(signer, mockStep, statusManager, mockSettings, chain)

    expect(mockedApprovedAllowance).toBeCalledWith(
      signer,
      mockStep.action.fromToken.address,
      mockStep.estimate.approvalAddress,
      {
        from: mockStep.action.fromToken.address,
        to: mockStep.estimate.approvalAddress,
      }
    )
  })
})
