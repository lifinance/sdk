import {
  BaseStepExecutor,
  type LiFiStepExtended,
  type PipelineSavedState,
  type SDKClient,
  type StepExecutorOptions,
  TaskPipeline,
} from '@lifi/sdk'
import type { Client } from 'viem'
import {
  isAtomicReadyWalletRejectedUpgradeError,
  parseEthereumErrors,
} from './errors/parseEthereumErrors.js'
import { createEthereumTaskPipeline } from './tasks/createEthereumTaskPipeline.js'
import { checkClient as checkClientHelper } from './tasks/helpers/checkClient.js'
import { getEthereumPipelineContext } from './tasks/helpers/getEthereumPipelineContext.js'

interface EthereumStepExecutorOptions extends StepExecutorOptions {
  client: Client
  switchChain?: (chainId: number) => Promise<Client | undefined>
}

export class EthereumStepExecutor extends BaseStepExecutor {
  private client: Client
  private switchChain?: (chainId: number) => Promise<Client | undefined>

  constructor(options: EthereumStepExecutorOptions) {
    super(options)
    this.client = options.client
    this.switchChain = options.switchChain
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended,
    atomicityNotReady = false
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const checkClientDeps = {
      getClient: () => this.client,
      setClient: (c: Client) => {
        this.client = c
      },
      statusManager: this.statusManager,
      allowUserInteraction: this.allowUserInteraction,
      switchChain: this.switchChain,
    }

    const destinationChainAction = step.execution?.actions.find(
      (a) => a.type === 'RECEIVING_CHAIN'
    )
    if (
      destinationChainAction &&
      destinationChainAction.substatus !== 'WAIT_DESTINATION_TRANSACTION'
    ) {
      const updatedClient = await checkClientHelper(
        step,
        destinationChainAction,
        undefined,
        checkClientDeps
      )
      if (!updatedClient) {
        return step
      }
    }

    const pipelineInput = await getEthereumPipelineContext(
      client,
      step,
      atomicityNotReady,
      {
        statusManager: this.statusManager,
        executionOptions: this.executionOptions,
        ethereumClient: this.client,
        allowUserInteraction: this.allowUserInteraction,
        checkClientDeps,
      }
    )
    if ('earlyExit' in pipelineInput) {
      return step
    }

    const { baseContext, extra } = pipelineInput
    const pipeline = new TaskPipeline(createEthereumTaskPipeline())

    try {
      const savedState = step.execution?.pipelineSavedState as
        | PipelineSavedState
        | undefined
      const result = savedState
        ? await pipeline.resume(savedState, baseContext)
        : await pipeline.run(baseContext)

      if (result.status === 'PAUSED') {
        step.execution.pipelineSavedState = {
          pausedAtTask: result.pausedAtTask,
          taskState: result.taskState,
          pipelineContext: result.pipelineContext,
        }
        return step
      }

      if (savedState) {
        delete step.execution.pipelineSavedState
      }
    } catch (e: any) {
      if (isAtomicReadyWalletRejectedUpgradeError(e) && !atomicityNotReady) {
        step.execution = undefined
        return this.executeStep(client, step, true)
      }
      const error = await parseEthereumErrors(e, step, extra.action)
      this.statusManager.updateAction(step, extra.actionType, 'FAILED', {
        error: { message: error.cause.message, code: error.code },
      })
      throw error
    }

    return step
  }
}
