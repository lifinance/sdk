import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SignedTypedData,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Client, GetAddressesReturnType } from 'viem'
import { getAddresses } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from './errors/parseEthereumErrors.js'
import { EthereumCheckAllowanceTask } from './tasks/EthereumCheckAllowanceTask.js'
import { EthereumCheckPermitsTask } from './tasks/EthereumCheckPermitsTask.js'
import { EthereumDestinationChainCheckClientTask } from './tasks/EthereumDestinationChainCheckClientTask.js'
import { EthereumNativePermitTask } from './tasks/EthereumNativePermitTask.js'
import { EthereumPrepareTransactionTask } from './tasks/EthereumPrepareTransactionTask.js'
import { EthereumResetAllowanceTask } from './tasks/EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './tasks/EthereumSetAllowanceTask.js'
import { EthereumSignAndExecuteTask } from './tasks/EthereumSignAndExecuteTask.js'
import { EthereumWaitForApprovalTransactionTask } from './tasks/EthereumWaitForApprovalTransaction.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import { switchChain } from './tasks/helpers/switchChain.js'
import type { EthereumStepExecutorContext } from './types.js'
import { getDomainChainId } from './utils/getDomainChainId.js'
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
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
    return updatedClient
  }

  getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<EthereumStepExecutorContext> => {
    const {
      isBridgeExecution,
      step,
      fromChain,
      executionOptions,
      client,
      retryParams,
      statusManager,
    } = baseContext

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    // Check if token needs approval and get approval transaction or message data when available
    const exchangeAction = statusManager.findAction(step, exchangeActionType)
    const checkForAllowance =
      // No existing swap/bridge transaction is pending
      !exchangeAction?.txHash &&
      // No existing swap/bridge batch/order is pending
      !exchangeAction?.taskId &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      executionOptions?.disableMessageSigning || step.type !== 'lifi'

    const actionPipelines = new ActionPipelineOrchestrator([
      new TaskPipeline(
        'PERMIT',
        [new EthereumCheckPermitsTask()],
        (context) => {
          const permitTypedData = context.step.typedData?.filter(
            (typedData) => typedData.primaryType === 'Permit'
          )
          return (
            checkForAllowance &&
            !!permitTypedData?.length &&
            !disableMessageSigning
          )
        }
      ),
      new TaskPipeline(
        'TOKEN_ALLOWANCE',
        [
          new EthereumCheckAllowanceTask(),
          new EthereumNativePermitTask(),
          new EthereumResetAllowanceTask(),
          new EthereumSetAllowanceTask(),
          new EthereumWaitForApprovalTransactionTask(),
        ],
        (context) => {
          const permitAction = context.statusManager.findAction(
            context.step,
            'PERMIT'
          )
          // Check if there's a signed permit for the source transaction chain
          const matchingPermit = permitAction?.signedTypedData.find(
            (signedTypedData: SignedTypedData) =>
              getDomainChainId(signedTypedData.domain) ===
              context.step.action.fromChainId
          )
          return checkForAllowance && !matchingPermit
        }
      ),
      new TaskPipeline(exchangeActionType, [
        new EthereumPrepareTransactionTask(),
        new EthereumSignAndExecuteTask(),
        new EthereumWaitForTransactionTask(),
        new WaitForTransactionStatusTask(),
      ]),
      new TaskPipeline(
        'RECEIVING_CHAIN',
        [
          new EthereumDestinationChainCheckClientTask(),
          new WaitForTransactionStatusTask(),
        ],
        () => isBridgeExecution
      ),
    ])

    return {
      ...baseContext,
      isFromNativeToken,
      disableMessageSigning,
      // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
      isPermit2Supported: (batchingSupported: boolean) =>
        !!fromChain.permit2 &&
        !!fromChain.permit2Proxy &&
        !isFromNativeToken &&
        !disableMessageSigning &&
        !batchingSupported &&
        // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
        !!step.estimate.approvalAddress &&
        !step.estimate.skipApproval &&
        !step.estimate.skipPermit,
      getExecutionStrategy: async (step: LiFiStepExtended) => {
        return await getEthereumExecutionStrategy(
          client,
          this.client,
          step,
          fromChain,
          retryParams
        )
      },
      ethereumClient: this.client,
      checkClient: this.checkClient,
      switchChain: this.switchChain,
      actionPipelines,
      parseErrors: (
        e: Error,
        step?: LiFiStepExtended,
        action?: ExecutionAction
      ) => parseEthereumErrors(e, step, action, retryParams),
      // Payload shared between tasks
      signedTypedData: [],
      calls: [],
      transactionRequest: undefined,
      shouldResetApproval: false,
      approvalResetTxHash: undefined,
    }
  }
}
