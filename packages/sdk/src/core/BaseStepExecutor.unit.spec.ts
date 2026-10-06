import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import {
  ExecuteStepRetryError,
  TransactionError,
  UnknownError,
} from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type {
  ExecutionAction,
  LiFiStepExtended,
  RouteExtended,
  SDKClient,
} from '../types/core.js'
import type {
  StepExecutorBaseContext,
  StepExecutorContext,
  TaskResult,
} from '../types/execution.js'
import { BaseStepExecutionTask } from './BaseStepExecutionTask.js'
import { BaseStepExecutor } from './BaseStepExecutor.js'
import { stopRouteExecution } from './execution.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { TaskPipeline } from './TaskPipeline.js'
import {
  assertNoOpenTransaction,
  CLEARED_TRANSACTION_FIELDS,
} from './transactionState.js'

class ThrowingTask extends BaseStepExecutionTask {
  constructor(private readonly error: Error) {
    super()
  }

  async run(_context: StepExecutorContext): Promise<TaskResult> {
    throw this.error
  }
}

class TestStepExecutor extends BaseStepExecutor {
  constructor(
    routeId: string,
    private readonly error: Error,
    private readonly parse: (
      error: Error
    ) => Promise<SDKError | ExecuteStepRetryError>
  ) {
    super({ routeId })
  }

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext> => baseContext as StepExecutorContext

  override createPipeline = (): TaskPipeline =>
    new TaskPipeline([new ThrowingTask(this.error)])

  override parseErrors = (
    error: Error
  ): Promise<SDKError | ExecuteStepRetryError> => this.parse(error)
}

const client = {
  getChainById: vi.fn(async (id: number) => ({ id })),
} as unknown as SDKClient

const setup = (swap: { txHash?: string }) => {
  const step: LiFiStepExtended = buildStepObject({ includingExecution: true })
  const swapAction = step.execution!.actions.find((a) => a.type === 'SWAP')!
  swapAction.txHash = swap.txHash
  const route = buildRouteObject({ step })
  executionState.create({
    route,
    executionOptions: { updateRouteHook: vi.fn() },
  })
  return { step, route }
}

const passThrough = async (error: Error): Promise<SDKError> =>
  new SDKError(error as TransactionError)

/** What the check of every sign task throws for the action. */
const conflictOf = (action: ExecutionAction): unknown => {
  try {
    assertNoOpenTransaction(action)
  } catch (error) {
    return error
  }
  return undefined
}

describe('BaseStepExecutor.executeStep failure handling', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => SOME_DATE)
  })

  it('writes txFinal with FAILED for a final error', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.',
      undefined,
      { final: true }
    )
    const executor = new TestStepExecutor(route.id, error, passThrough)

    await expect(executor.executeStep(client, step)).rejects.toBeInstanceOf(
      SDKError
    )

    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('FAILED')
    expect(swap.txFinal).toBe(true)
    expect(swap.txHash).toBe('0xswap')
  })

  it('does not write txFinal for an unknown outcome', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction confirmation timeout.'
    )
    const executor = new TestStepExecutor(route.id, error, passThrough)

    await expect(executor.executeStep(client, step)).rejects.toThrow()

    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('FAILED')
    expect(swap.txFinal).toBeUndefined()
  })

  it('keeps the marker when the parser rebuilds the error', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction failed: simulate this',
      undefined,
      { final: true }
    )
    // Rebuilds from scratch, like parseSolanaErrors for "simulate" messages.
    const rebuild = async (): Promise<SDKError> =>
      new SDKError(
        new TransactionError(
          LiFiErrorCode.TransactionSimulationFailed,
          'rebuilt'
        )
      )
    const executor = new TestStepExecutor(route.id, error, rebuild)

    await expect(executor.executeStep(client, step)).rejects.toThrow()

    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.txFinal).toBe(true)
  })

  it('turns a retry into a failure while the step has an open transaction', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new Error('wallet rejected upgrade')
    const retry = async (e: Error): Promise<ExecuteStepRetryError> =>
      new ExecuteStepRetryError('retry', { atomicityNotReady: true }, e)
    const executor = new TestStepExecutor(route.id, error, retry)

    const thrown = await executor.executeStep(client, step).catch((e) => e)

    expect(thrown).toBeInstanceOf(SDKError)
    expect(thrown).not.toBeInstanceOf(ExecuteStepRetryError)
    expect((thrown as SDKError).cause).toBeInstanceOf(UnknownError)
    expect((thrown as SDKError).cause.message).toBe('wallet rejected upgrade')
    expect((thrown as SDKError).cause.cause).toBe(error)
    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('FAILED')
    expect(swap.txHash).toBe('0xswap')
    expect(swap.txFinal).toBeUndefined()
  })

  it('does not write txFinal when a final error is turned from a retry into a failure', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.',
      undefined,
      { final: true }
    )
    const retry = async (e: Error): Promise<ExecuteStepRetryError> =>
      new ExecuteStepRetryError('retry', { atomicityNotReady: true }, e)
    const executor = new TestStepExecutor(route.id, error, retry)

    await expect(executor.executeStep(client, step)).rejects.toBeInstanceOf(
      SDKError
    )

    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('FAILED')
    expect(swap.txHash).toBe('0xswap')
    expect(swap.txFinal).toBeUndefined()
  })

  // The widget picks its text by the code, so InternalError would hide the
  // reason of the original error.
  it('keeps the code of an original BaseError when a retry is turned into a failure', async () => {
    const { step, route } = setup({ txHash: '0xswap' })
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.',
      undefined,
      { final: true }
    )
    const retry = async (e: Error): Promise<ExecuteStepRetryError> =>
      new ExecuteStepRetryError('retry', { atomicityNotReady: true }, e)
    const executor = new TestStepExecutor(route.id, error, retry)

    const thrown = await executor.executeStep(client, step).catch((e) => e)

    expect(thrown).toBeInstanceOf(SDKError)
    expect((thrown as SDKError).code).toBe(LiFiErrorCode.TransactionFailed)
    expect((thrown as SDKError).cause).toBe(error)
    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('FAILED')
    expect(swap.error?.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(swap.error?.message).toBe('Transaction was reverted.')
    expect(swap.txHash).toBe('0xswap')
    expect(swap.txFinal).toBeUndefined()
  })

  // A task asks for the replay itself (EVM prepare, JUMEMB-102), after a late
  // write of an older run merged a transaction into the step.
  it.each(['txHash', 'taskId'] as const)(
    'fails a refused replay request as the sign task does while the SWAP has a %s',
    async (field) => {
      const { step, route } = setup({})
      const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
      swap[field] = '0xopen'
      const conflict = conflictOf(swap)
      expect(conflict).toBeInstanceOf(TransactionError)
      const error = new ExecuteStepRetryError('retry in relayed', {
        strategyAfterPrepare: 'relayed',
      })
      // As `parseEthereumErrors`: a replay request passes unchanged.
      const keep = async (e: Error): Promise<ExecuteStepRetryError> =>
        e as ExecuteStepRetryError
      const executor = new TestStepExecutor(route.id, error, keep)

      const thrown = await executor.executeStep(client, step).catch((e) => e)

      expect(thrown).toBeInstanceOf(SDKError)
      expect(thrown).not.toBeInstanceOf(ExecuteStepRetryError)
      expect((thrown as SDKError).code).toBe(LiFiErrorCode.TransactionConflict)
      expect((thrown as SDKError).cause).toBeInstanceOf(TransactionError)
      expect((thrown as SDKError).cause).toEqual(conflict)
      expect(swap.status).toBe('FAILED')
      expect(swap.error).toEqual({
        code: LiFiErrorCode.TransactionConflict,
        message: (conflict as TransactionError).message,
      })
      expect(swap[field]).toBe('0xopen')
      expect(swap.txFinal).toBeUndefined()
    }
  )

  it('still retries when the step has no transaction data', async () => {
    const { step, route } = setup({})
    const error = new Error('wallet rejected upgrade')
    const retry = async (e: Error): Promise<ExecuteStepRetryError> =>
      new ExecuteStepRetryError('retry', { atomicityNotReady: true }, e)
    const executor = new TestStepExecutor(route.id, error, retry)

    await expect(executor.executeStep(client, step)).rejects.toBeInstanceOf(
      ExecuteStepRetryError
    )
    const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
    expect(swap.status).toBe('PENDING')
  })
})

/** Waits for `gate`, then does `act` with the step's context. */
class GatedTask extends BaseStepExecutionTask {
  constructor(
    private readonly gate: Promise<void>,
    private readonly act: (context: StepExecutorContext) => void
  ) {
    super()
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    await this.gate
    this.act(context)
    return { status: 'COMPLETED' }
  }
}

class GatedStepExecutor extends BaseStepExecutor {
  constructor(
    routeId: string,
    private readonly task: BaseStepExecutionTask
  ) {
    super({ routeId })
  }

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext> => baseContext as StepExecutorContext

  override createPipeline = (): TaskPipeline => new TaskPipeline([this.task])

  override parseErrors = (error: Error): Promise<SDKError> => passThrough(error)
}

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.
describe('BaseStepExecutor after stopRouteExecution', () => {
  /** Starts the step on a registered executor and stops the route. */
  const runAndStop = (
    swap: { txHash?: string },
    act: (context: StepExecutorContext) => void
  ): {
    hook: Mock
    release: () => void
    running: Promise<unknown>
  } => {
    const { step, route } = setup(swap)
    const execution = executionState.get(route.id)!
    const hook = execution.executionOptions!.updateRouteHook as Mock
    const gate = Promise.withResolvers<void>()
    const executor = new GatedStepExecutor(
      route.id,
      new GatedTask(gate.promise, act)
    )
    execution.executors.push(executor)
    // In flight until the step settles, as `executeSteps` counts it.
    executionState.retain(route.id)
    const running = executor
      .executeStep(client, step)
      .catch((e) => e)
      .finally(() => executionState.release(route.id))
    stopRouteExecution(route)
    return { hook, release: () => gate.resolve(), running }
  }

  const swapOf = (route: RouteExtended): ExecutionAction | undefined =>
    route.steps[0].execution?.actions.find((a) => a.type === 'SWAP')

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => SOME_DATE)
  })

  it('delivers a txHash that a task writes after the stop to the kept hook', async () => {
    const { hook, release, running } = runAndStop(
      {},
      ({ statusManager, step }) =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', {
          ...CLEARED_TRANSACTION_FIELDS,
          txHash: '0xlate',
          signedAt: SOME_DATE,
        })
    )

    release()
    await running

    expect(hook).toHaveBeenCalledTimes(1)
    expect(swapOf(hook.mock.calls[0][0] as RouteExtended)?.txHash).toBe(
      '0xlate'
    )
  })

  it('delivers the FAILED + txFinal write of the catch block after the stop', async () => {
    const final = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.',
      undefined,
      { final: true }
    )
    const { hook, release, running } = runAndStop({ txHash: '0xswap' }, () => {
      throw final
    })

    release()
    expect(await running).toBeInstanceOf(SDKError)

    expect(hook).toHaveBeenCalledTimes(1)
    const swap = swapOf(hook.mock.calls[0][0] as RouteExtended)
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txFinal).toBe(true)
    expect(swap?.txHash).toBe('0xswap')
  })

  it('keeps the FAILED write of the catch block without txFinal suppressed after the stop', async () => {
    const unknown = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction confirmation timeout.'
    )
    const { hook, release, running } = runAndStop({ txHash: '0xswap' }, () => {
      throw unknown
    })

    release()
    expect(await running).toBeInstanceOf(SDKError)

    expect(hook).not.toHaveBeenCalled()
  })
})
