import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import {
  ExecuteStepRetryError,
  TransactionError,
  UnknownError,
} from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { LiFiStepExtended, SDKClient } from '../types/core.js'
import type {
  StepExecutorBaseContext,
  StepExecutorContext,
  TaskResult,
} from '../types/execution.js'
import { BaseStepExecutionTask } from './BaseStepExecutionTask.js'
import { BaseStepExecutor } from './BaseStepExecutor.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { TaskPipeline } from './TaskPipeline.js'

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
