import type { LiFiStep } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./helpers/checkBalance.js', () => ({
  checkBalance: vi.fn(async () => undefined),
}))

import { LiFiErrorCode } from '../../errors/constants.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { CheckBalanceTask } from './CheckBalanceTask.js'
import {
  type CheckBalanceOptions,
  checkBalance,
} from './helpers/checkBalance.js'

const WALLET = '0xWallet'

const buildStep = (): LiFiStep =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'lifi',
    action: {
      fromChainId: 1,
      fromAddress: WALLET,
    },
    estimate: { gasCosts: [], feeCosts: [] },
  }) as unknown as LiFiStep

const buildContext = (
  step: LiFiStep,
  overrides?: Partial<StepExecutorContext>
): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      initializeAction: vi.fn(),
    } as any,
    isBridgeExecution: false,
    ...overrides,
  }) as unknown as StepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CheckBalanceTask — base contract', () => {
  it('default getCheckBalanceOptions returns {} and run() forwards {} to checkBalance', async () => {
    // Locks the contract subclasses rely on — without this, dropping or
    // stopping to forward the hook silently turns every override into a
    // no-op.
    const task = new CheckBalanceTask()
    const step = buildStep()
    const context = buildContext(step)

    await task.run(context)

    expect(vi.mocked(checkBalance)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(checkBalance)).toHaveBeenCalledWith(
      context.client,
      WALLET,
      step,
      {}
    )
  })

  it('forwards overridden options as the 4th arg, calling getCheckBalanceOptions exactly once with the same context', async () => {
    const overrideSpy = vi.fn(
      async (_context: StepExecutorContext): Promise<CheckBalanceOptions> => ({
        walletPaysGas: false,
      })
    )

    class TestTask extends CheckBalanceTask {
      protected override getCheckBalanceOptions(
        context: StepExecutorContext
      ): Promise<CheckBalanceOptions> {
        return overrideSpy(context)
      }
    }

    const task = new TestTask()
    const step = buildStep()
    const context = buildContext(step)

    await task.run(context)

    expect(overrideSpy).toHaveBeenCalledTimes(1)
    expect(overrideSpy.mock.calls[0][0]).toBe(context)
    expect(vi.mocked(checkBalance)).toHaveBeenCalledWith(
      context.client,
      WALLET,
      step,
      { walletPaysGas: false }
    )
  })

  it('throws when fromAddress is missing — guard runs BEFORE getCheckBalanceOptions and checkBalance', async () => {
    // Pins the guard order so subclass overrides never make RPC calls
    // for wallet-less steps.
    const overrideSpy = vi.fn()
    class TestTask extends CheckBalanceTask {
      protected override getCheckBalanceOptions(
        _context: StepExecutorContext
      ): Promise<CheckBalanceOptions> {
        overrideSpy()
        return Promise.resolve({})
      }
    }
    const step = buildStep()
    step.action.fromAddress = undefined

    await expect(new TestTask().run(buildContext(step))).rejects.toMatchObject({
      code: LiFiErrorCode.InternalError,
      message: 'The wallet address is undefined.',
    })
    expect(overrideSpy).not.toHaveBeenCalled()
    expect(vi.mocked(checkBalance)).not.toHaveBeenCalled()
  })
})
