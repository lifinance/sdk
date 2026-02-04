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
import { EthereumAllowanceEnsureClientTask } from './tasks/allowance/EthereumAllowanceEnsureClientTask.js'
import { EthereumAllowanceExecuteAsBatchTask } from './tasks/allowance/EthereumAllowanceExecuteAsBatchTask.js'
import { EthereumAllowanceExecuteOnChainTask } from './tasks/allowance/EthereumAllowanceExecuteOnChainTask.js'
import { EthereumAllowanceGetOrCreateActionTask } from './tasks/allowance/EthereumAllowanceGetOrCreateActionTask.js'
import { EthereumAllowanceGetSpenderTask } from './tasks/allowance/EthereumAllowanceGetSpenderTask.js'
import { EthereumAllowancePrepareResetStatusTask } from './tasks/allowance/EthereumAllowancePrepareResetStatusTask.js'
import { EthereumAllowanceRunPermitsTask } from './tasks/allowance/EthereumAllowanceRunPermitsTask.js'
import { EthereumAllowanceTryNativePermitTask } from './tasks/allowance/EthereumAllowanceTryNativePermitTask.js'
import { EthereumAllowanceWaitForPendingApprovalTask } from './tasks/allowance/EthereumAllowanceWaitForPendingApprovalTask.js'
import { EthereumCheckBalanceTask } from './tasks/EthereumCheckBalanceTask.js'
import { EthereumDestinationChainCheckTask } from './tasks/EthereumDestinationChainCheckTask.js'
import { EthereumPrepareTransactionTask } from './tasks/EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteBatchTask } from './tasks/EthereumSignAndExecuteBatchTask.js'
import { EthereumSignAndExecuteRelayerTask } from './tasks/EthereumSignAndExecuteRelayerTask.js'
import { EthereumSignAndExecuteStandardTask } from './tasks/EthereumSignAndExecuteStandardTask.js'
import { EthereumWaitForDestinationChainTask } from './tasks/EthereumWaitForDestinationChainTask.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import type { EthereumTaskExtra } from './tasks/types.js'

interface EthereumStepExecutorOptions extends StepExecutorOptions {
  client: Client
  switchChain?: (chainId: number) => Promise<Client | undefined>
}

const allowanceTasksStandardRelayer = [
  new EthereumAllowanceRunPermitsTask(),
  new EthereumAllowanceGetOrCreateActionTask(),
  new EthereumAllowanceEnsureClientTask(),
  new EthereumAllowanceWaitForPendingApprovalTask(),
  new EthereumAllowanceGetSpenderTask(),
  new EthereumAllowanceTryNativePermitTask(),
  new EthereumAllowancePrepareResetStatusTask(),
  new EthereumAllowanceExecuteOnChainTask(),
]

const allowanceTasksBatch = [
  new EthereumAllowanceRunPermitsTask(),
  new EthereumAllowanceGetOrCreateActionTask(),
  new EthereumAllowanceEnsureClientTask(),
  new EthereumAllowanceWaitForPendingApprovalTask(),
  new EthereumAllowanceGetSpenderTask(),
  new EthereumAllowancePrepareResetStatusTask(),
  new EthereumAllowanceExecuteAsBatchTask(),
]

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

    const tasks =
      executionStrategy === 'relayer'
        ? [
            new EthereumDestinationChainCheckTask(),
            ...allowanceTasksStandardRelayer,
            new EthereumCheckBalanceTask(),
            new EthereumPrepareTransactionTask(),
            new EthereumSignAndExecuteRelayerTask(),
            new EthereumWaitForTransactionTask(),
            new EthereumWaitForDestinationChainTask(),
          ]
        : executionStrategy === 'batch'
          ? [
              new EthereumDestinationChainCheckTask(),
              ...allowanceTasksBatch,
              new EthereumCheckBalanceTask(),
              new EthereumPrepareTransactionTask(),
              new EthereumSignAndExecuteBatchTask(),
              new EthereumWaitForTransactionTask(),
              new EthereumWaitForDestinationChainTask(),
            ]
          : [
              new EthereumDestinationChainCheckTask(),
              ...allowanceTasksStandardRelayer,
              new EthereumCheckBalanceTask(),
              new EthereumPrepareTransactionTask(),
              new EthereumSignAndExecuteStandardTask(),
              new EthereumWaitForTransactionTask(),
              new EthereumWaitForDestinationChainTask(),
            ]
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
