import { describe, expect, it, vi } from 'vitest'
import { TransactionError } from '../errors/errors.js'
import type { LiFiStep, StatusManager } from '../index.js'
import { stepComparison } from './stepComparison.js'

describe('stepComparison', () => {
  const mockStatusManager = {
    updateStepInRoute: vi.fn((step) => step),
  } as unknown as StatusManager

  const oldStep: LiFiStep = {
    id: 'test',
    type: 'swap',
    tool: 'test',
    action: {
      fromChainId: 1,
      fromAmount: '1000',
      fromToken: { address: '0x1', decimals: 18, chainId: 1 },
      toChainId: 1,
      toToken: { address: '0x2', decimals: 18, chainId: 1 },
      slippage: 0.003,
    },
    estimate: {
      toAmount: '2000',
      toAmountMin: '1940',
    },
  } as any

  const newStep: LiFiStep = {
    ...oldStep,
    estimate: {
      toAmount: '1950',
      toAmountMin: '1940',
    },
  } as any

  it('should return updated step if within slippage threshold', async () => {
    const result = await stepComparison(
      mockStatusManager,
      oldStep,
      newStep,
      false
    )

    expect(result).toBeDefined()
    expect(mockStatusManager.updateStepInRoute).toHaveBeenCalled()
  })

  it('should throw error when rate changed and user declined', async () => {
    const farNewStep = {
      ...oldStep,
      estimate: {
        toAmount: '100',
        toAmountMin: '50',
      },
    } as any

    await expect(
      stepComparison(mockStatusManager, oldStep, farNewStep, false)
    ).rejects.toThrow(TransactionError)
  })

  it('should call acceptExchangeRateUpdateHook when user interaction allowed', async () => {
    const acceptHook = vi.fn().mockResolvedValue(true)

    const farNewStep = {
      ...oldStep,
      estimate: {
        toAmount: '100',
        toAmountMin: '50',
      },
    } as any

    const executionOptions = {
      acceptExchangeRateUpdateHook: acceptHook,
    }

    const result = await stepComparison(
      mockStatusManager,
      oldStep,
      farNewStep,
      true,
      executionOptions
    )

    expect(acceptHook).toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})
