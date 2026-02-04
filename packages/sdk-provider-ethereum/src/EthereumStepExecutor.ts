import {
  BaseStepExecutor,
  type ExecutionAction,
  type LiFiStepExtended,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { parseEthereumErrors } from './errors/parseEthereumErrors.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import { getEthereumExecutionTasks } from './tasks/helpers/getEthereumExecutionTasks.js'
import type { EthereumTaskExtra } from './tasks/types.js'

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

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<unknown> => {
    const executionStrategy = await getEthereumExecutionStrategy(
      baseContext,
      this.client
    )

    const tasks = getEthereumExecutionTasks(executionStrategy)
    const pipeline = new TaskPipeline<EthereumTaskExtra, unknown>(tasks)

    return {
      ...baseContext,
      executionStrategy,
      ethereumClient: this.client,
      getClient: () => this.client,
      setClient: (c: Client) => {
        this.client = c
      },
      switchChain: this.switchChain,
      pipeline,
      parseErrors: (
        e: Error,
        step?: LiFiStepExtended,
        action?: ExecutionAction
      ) => parseEthereumErrors(e, step, action, baseContext.retryParams),
    }
  }
}
