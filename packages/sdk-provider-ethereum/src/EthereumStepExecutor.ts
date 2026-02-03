import {
  BaseStepExecutor,
  type ExecutionAction,
  type LiFiStepExtended,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { isBatchingSupported } from './actions/isBatchingSupported.js'
import { EthereumCheckAllowanceTask } from './tasks/EthereumCheckAllowanceTask.js'
import { EthereumCheckBalanceTask } from './tasks/EthereumCheckBalanceTask.js'
import { EthereumDestinationChainCheckTask } from './tasks/EthereumDestinationChainCheckTask.js'
import { EthereumPrepareTransactionTask } from './tasks/EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteTask } from './tasks/EthereumSignAndExecuteTask.js'
import { EthereumWaitForDestinationChainTask } from './tasks/EthereumWaitForDestinationChainTask.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'
import { checkClient as checkClientHelper } from './tasks/helpers/checkClient.js'
import type {
  EthereumExecutionStrategy,
  EthereumTaskExtra,
} from './tasks/types.js'
import { isRelayerStep } from './utils/isRelayerStep.js'
import { isZeroAddress } from './utils/isZeroAddress.js'

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
    const atomicityNotReady = !!baseContext.retryParams?.atomicityNotReady
    const isRelayer = isRelayerStep(baseContext.step)
    const { fromChain } = baseContext
    const batchingSupported =
      atomicityNotReady || baseContext.step.tool === 'thorswap' || isRelayer
        ? false
        : await isBatchingSupported(baseContext.client, {
            client: this.client,
            chainId: fromChain.id,
          })

    const executionStrategy: EthereumExecutionStrategy = isRelayer
      ? 'relayer'
      : batchingSupported
        ? 'batch'
        : 'standard'

    const isFromNativeToken =
      fromChain.nativeToken.address ===
        baseContext.step.action.fromToken.address &&
      isZeroAddress(baseContext.step.action.fromToken.address)

    const disableMessageSigning =
      baseContext.executionOptions?.disableMessageSigning ||
      baseContext.step.type !== 'lifi'

    const permit2Supported =
      !!fromChain.permit2 &&
      !!fromChain.permit2Proxy &&
      !batchingSupported &&
      !isFromNativeToken &&
      !disableMessageSigning &&
      !!baseContext.step.estimate.approvalAddress &&
      !baseContext.step.estimate.skipApproval &&
      !baseContext.step.estimate.skipPermit

    // TODO: Define tasks per execution strategy
    const sharedTasks = [
      new EthereumDestinationChainCheckTask(),
      new EthereumCheckAllowanceTask(),
      new EthereumCheckBalanceTask(),
      new EthereumPrepareTransactionTask(),
      new EthereumSignAndExecuteTask(),
      new EthereumWaitForTransactionTask(),
      new EthereumWaitForDestinationChainTask(),
    ]
    let tasks: (typeof sharedTasks)[number][]
    switch (executionStrategy) {
      case 'standard':
        tasks = sharedTasks
        break
      case 'relayer':
        tasks = sharedTasks
        break
      case 'batch':
        tasks = sharedTasks
        break
      default:
        tasks = sharedTasks
    }
    const pipeline = new TaskPipeline<EthereumTaskExtra, unknown>(tasks)

    const checkClient = (
      s: LiFiStepExtended,
      action: ExecutionAction,
      targetChainId?: number
    ) =>
      checkClientHelper(s, action, targetChainId, {
        getClient: () => this.client,
        setClient: (c: Client) => {
          this.client = c
        },
        statusManager: baseContext.statusManager,
        allowUserInteraction: baseContext.allowUserInteraction,
        switchChain: this.switchChain,
      })

    return {
      ...baseContext,
      executionStrategy,
      calls: [] as EthereumTaskExtra['calls'],
      signedTypedData: [] as EthereumTaskExtra['signedTypedData'],
      batchingSupported,
      permit2Supported,
      ethereumClient: this.client,
      checkClient,
      pipeline,
    }
  }
}
