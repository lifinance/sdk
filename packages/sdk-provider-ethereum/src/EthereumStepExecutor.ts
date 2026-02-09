import {
  BaseStepExecutor,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type StepExecutionError,
  type StepExecutorBaseContext,
  type StepExecutorContext,
  type StepExecutorOptions,
  TaskPipeline,
  TransactionError,
  WaitForDestinationChainTask,
} from '@lifi/sdk'
import type { Client, GetAddressesReturnType } from 'viem'
import { getAddresses } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from './errors/parseEthereumErrors.js'
import { EthereumCheckAndExecuteTask } from './tasks/EthereumCheckAndExecuteTask.js'
import { EthereumDestinationChainCheckClientTask } from './tasks/EthereumDestinationChainCheckClientTask.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import { switchChain } from './tasks/helpers/switchChain.js'
import type { EthereumTaskExtra } from './tasks/types.js'
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

  // Ensure that we are using the right chain and wallet when executing transactions.
  checkClient = async (
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ) => {
    const updatedClient = await switchChain(
      this.client,
      this.statusManager,
      step,
      action,
      targetChainId ?? step.action.fromChainId,
      this.allowUserInteraction,
      this.switchChain
    )
    if (updatedClient) {
      this.client = updatedClient
    }

    // Prevent execution of the quote by wallet different from the one which requested the quote
    let accountAddress = this.client.account?.address
    if (!accountAddress) {
      const accountAddresses = (await getAction(
        this.client,
        getAddresses,
        'getAddresses'
      )(undefined)) as GetAddressesReturnType
      accountAddress = accountAddresses?.[0]
    }
    if (
      accountAddress?.toLowerCase() !== step.action.fromAddress?.toLowerCase()
    ) {
      const errorMessage =
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      this.statusManager.updateAction(step, action.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.WalletChangedDuringExecution,
          message: errorMessage,
        },
      })
      // TODO: handle errors in one place
      throw await parseEthereumErrors(
        new TransactionError(
          LiFiErrorCode.WalletChangedDuringExecution,
          errorMessage
        ),
        step,
        action
      )
    }
    return updatedClient
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext<EthereumTaskExtra>> => {
    const tasks = [
      new EthereumDestinationChainCheckClientTask(),
      new EthereumCheckAndExecuteTask(),
      new EthereumWaitForTransactionTask(),
      new WaitForDestinationChainTask<EthereumTaskExtra>(),
    ]

    const pipeline = new TaskPipeline<EthereumTaskExtra>(tasks)

    const isFromNativeToken =
      baseContext.fromChain.nativeToken.address ===
        baseContext.step.action.fromToken.address &&
      isZeroAddress(baseContext.step.action.fromToken.address)

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      baseContext.executionOptions?.disableMessageSigning ||
      baseContext.step.type !== 'lifi'

    return {
      ...baseContext,
      isFromNativeToken,
      disableMessageSigning,
      // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
      isPermit2Supported: (batchingSupported: boolean) =>
        !!baseContext.fromChain.permit2 &&
        !!baseContext.fromChain.permit2Proxy &&
        !isFromNativeToken &&
        !disableMessageSigning &&
        !batchingSupported &&
        // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
        !!baseContext.step.estimate.approvalAddress &&
        !baseContext.step.estimate.skipApproval &&
        !baseContext.step.estimate.skipPermit,
      getExecutionStrategy: async (step: LiFiStepExtended) => {
        return await getEthereumExecutionStrategy(
          baseContext.client,
          this.client,
          step,
          baseContext.fromChain,
          baseContext.retryParams
        )
      },
      ethereumClient: this.client,
      checkClient: this.checkClient,
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
