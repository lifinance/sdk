import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  type LiFiStepExtended,
  type StepExecutionError,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
  WaitForDestinationChainTask,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { parseEthereumErrors } from './errors/parseEthereumErrors.js'
import { EthereumBatchEnsureClientTask } from './tasks/batch/EthereumBatchEnsureClientTask.js'
import { EthereumBatchExecuteAsBatchTask } from './tasks/batch/EthereumBatchExecuteAsBatchTask.js'
import { EthereumBatchGetOrCreateActionTask } from './tasks/batch/EthereumBatchGetOrCreateActionTask.js'
import { EthereumBatchGetSpenderTask } from './tasks/batch/EthereumBatchGetSpenderTask.js'
import { EthereumBatchPrepareResetStatusTask } from './tasks/batch/EthereumBatchPrepareResetStatusTask.js'
import { EthereumBatchPrepareTransactionTask } from './tasks/batch/EthereumBatchPrepareTransactionTask.js'
import { EthereumBatchRunPermitsTask } from './tasks/batch/EthereumBatchRunPermitsTask.js'
import { EthereumBatchSignAndExecuteTask } from './tasks/batch/EthereumBatchSignAndExecuteTask.js'
import { EthereumBatchWaitForPendingApprovalTask } from './tasks/batch/EthereumBatchWaitForPendingApprovalTask.js'
import { EthereumBatchWaitForTransactionTask } from './tasks/batch/EthereumBatchWaitForTransactionTask.js'
import { EthereumDestinationChainCheckTask } from './tasks/EthereumDestinationChainCheckTask.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import { EthereumRelayerEnsureClientTask } from './tasks/relayer/EthereumRelayerEnsureClientTask.js'
import { EthereumRelayerExecuteOnChainTask } from './tasks/relayer/EthereumRelayerExecuteOnChainTask.js'
import { EthereumRelayerGetOrCreateActionTask } from './tasks/relayer/EthereumRelayerGetOrCreateActionTask.js'
import { EthereumRelayerGetSpenderTask } from './tasks/relayer/EthereumRelayerGetSpenderTask.js'
import { EthereumRelayerPrepareResetStatusTask } from './tasks/relayer/EthereumRelayerPrepareResetStatusTask.js'
import { EthereumRelayerPrepareTransactionTask } from './tasks/relayer/EthereumRelayerPrepareTransactionTask.js'
import { EthereumRelayerRunPermitsTask } from './tasks/relayer/EthereumRelayerRunPermitsTask.js'
import { EthereumRelayerSignAndExecuteTask } from './tasks/relayer/EthereumRelayerSignAndExecuteTask.js'
import { EthereumRelayerTryNativePermitTask } from './tasks/relayer/EthereumRelayerTryNativePermitTask.js'
import { EthereumRelayerWaitForPendingApprovalTask } from './tasks/relayer/EthereumRelayerWaitForPendingApprovalTask.js'
import { EthereumRelayerWaitForTransactionTask } from './tasks/relayer/EthereumRelayerWaitForTransactionTask.js'
import { EthereumStandardEnsureClientTask } from './tasks/standard/EthereumStandardEnsureClientTask.js'
import { EthereumStandardExecuteOnChainTask } from './tasks/standard/EthereumStandardExecuteOnChainTask.js'
import { EthereumStandardGetOrCreateActionTask } from './tasks/standard/EthereumStandardGetOrCreateActionTask.js'
import { EthereumStandardGetSpenderTask } from './tasks/standard/EthereumStandardGetSpenderTask.js'
import { EthereumStandardPrepareResetStatusTask } from './tasks/standard/EthereumStandardPrepareResetStatusTask.js'
import { EthereumStandardPrepareTransactionTask } from './tasks/standard/EthereumStandardPrepareTransactionTask.js'
import { EthereumStandardRunPermitsTask } from './tasks/standard/EthereumStandardRunPermitsTask.js'
import { EthereumStandardSignAndExecuteTask } from './tasks/standard/EthereumStandardSignAndExecuteTask.js'
import { EthereumStandardTryNativePermitTask } from './tasks/standard/EthereumStandardTryNativePermitTask.js'
import { EthereumStandardWaitForPendingApprovalTask } from './tasks/standard/EthereumStandardWaitForPendingApprovalTask.js'
import { EthereumStandardWaitForTransactionTask } from './tasks/standard/EthereumStandardWaitForTransactionTask.js'
import type { EthereumTaskExtra } from './tasks/types.js'

interface EthereumStepExecutorOptions extends StepExecutorOptions {
  client: Client
  switchChain?: (chainId: number) => Promise<Client | undefined>
}

const allowanceTasksStandard = [
  new EthereumStandardRunPermitsTask(),
  new EthereumStandardGetOrCreateActionTask(),
  new EthereumStandardEnsureClientTask(),
  new EthereumStandardWaitForPendingApprovalTask(),
  new EthereumStandardGetSpenderTask(),
  new EthereumStandardTryNativePermitTask(),
  new EthereumStandardPrepareResetStatusTask(),
  new EthereumStandardExecuteOnChainTask(),
]

const allowanceTasksRelayer = [
  new EthereumRelayerRunPermitsTask(),
  new EthereumRelayerGetOrCreateActionTask(),
  new EthereumRelayerEnsureClientTask(),
  new EthereumRelayerWaitForPendingApprovalTask(),
  new EthereumRelayerGetSpenderTask(),
  new EthereumRelayerTryNativePermitTask(),
  new EthereumRelayerPrepareResetStatusTask(),
  new EthereumRelayerExecuteOnChainTask(),
]

const allowanceTasksBatch = [
  new EthereumBatchRunPermitsTask(),
  new EthereumBatchGetOrCreateActionTask(),
  new EthereumBatchEnsureClientTask(),
  new EthereumBatchWaitForPendingApprovalTask(),
  new EthereumBatchGetSpenderTask(),
  new EthereumBatchPrepareResetStatusTask(),
  new EthereumBatchExecuteAsBatchTask(),
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
            ...allowanceTasksRelayer,
            new CheckBalanceTask<EthereumTaskExtra>(),
            new EthereumRelayerPrepareTransactionTask(),
            new EthereumRelayerSignAndExecuteTask(),
            new EthereumRelayerWaitForTransactionTask(),
            new WaitForDestinationChainTask<EthereumTaskExtra>(),
          ]
        : executionStrategy === 'batch'
          ? [
              new EthereumDestinationChainCheckTask(),
              ...allowanceTasksBatch,
              new CheckBalanceTask<EthereumTaskExtra>(),
              new EthereumBatchPrepareTransactionTask(),
              new EthereumBatchSignAndExecuteTask(),
              new EthereumBatchWaitForTransactionTask(),
              new WaitForDestinationChainTask<EthereumTaskExtra>(),
            ]
          : [
              new EthereumDestinationChainCheckTask(),
              ...allowanceTasksStandard,
              new CheckBalanceTask<EthereumTaskExtra>(),
              new EthereumStandardPrepareTransactionTask(),
              new EthereumStandardSignAndExecuteTask(),
              new EthereumStandardWaitForTransactionTask(),
              new WaitForDestinationChainTask<EthereumTaskExtra>(),
            ]
    const pipeline = new TaskPipeline<EthereumTaskExtra, unknown>(tasks)

    return {
      ...baseContext,
      executionStrategy,
      ethereumClient: this.client,
      getWalletAddress: () => {
        const address = this.client.account?.address
        if (!address) {
          throw new Error('Wallet account is not available.')
        }
        return address
      },
      getClient: () => this.client,
      setClient: (c: Client) => {
        this.client = c
      },
      switchChain: this.switchChain,
      pipeline,
      parseErrors: (
        e: StepExecutionError,
        step?: LiFiStepExtended,
        action?: ExecutionAction
      ) => parseEthereumErrors(e, step, action, baseContext.retryParams),
    }
  }
}
