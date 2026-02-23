import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
  TransactionError,
} from '@lifi/sdk'
import type { Client, GetAddressesReturnType } from 'viem'
import { getAddresses } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from '../errors/parseEthereumErrors.js'
import type { EthereumStepExecutorContext } from '../types.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { EthereumCheckAllowanceTask } from './tasks/EthereumCheckAllowanceTask.js'
import { EthereumCheckPermitsTask } from './tasks/EthereumCheckPermitsTask.js'
import { EthereumNativePermitTask } from './tasks/EthereumNativePermitTask.js'
import { EthereumPrepareTransactionTask } from './tasks/EthereumPrepareTransactionTask.js'
import { EthereumResetAllowanceTask } from './tasks/EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './tasks/EthereumSetAllowanceTask.js'
import { EthereumSignAndExecuteTask } from './tasks/EthereumSignAndExecuteTask.js'
import { EthereumWaitForApprovalTransactionTask } from './tasks/EthereumWaitForApprovalTransactionTask.js'
import { EthereumWaitForTransactionStatusTask } from './tasks/EthereumWaitForTransactionStatusTask.js'
import { EthereumWaitForTransactionTask } from './tasks/EthereumWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
import { shouldCheckForAllowance } from './tasks/helpers/shouldCheckForAllowance.js'
import { switchChain } from './tasks/helpers/switchChain.js'

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
  checkClient = async (step: LiFiStepExtended, targetChainId?: number) => {
    const updatedClient = await switchChain(
      this.client,
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

  getFirstTaskName = (
    step: LiFiStepExtended,
    isBridgeExecution: boolean,
    isFromNativeToken: boolean
  ) => {
    const doCheckAllowance = shouldCheckForAllowance(
      step,
      isBridgeExecution,
      isFromNativeToken,
      this.statusManager
    )

    if (doCheckAllowance) {
      return EthereumCheckPermitsTask.name
    }

    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!(swapOrBridgeAction?.txHash || swapOrBridgeAction?.taskId)) {
      return CheckBalanceTask.name
    }

    if (swapOrBridgeAction?.status !== 'DONE') {
      return EthereumWaitForTransactionTask.name
    }

    return EthereumWaitForTransactionStatusTask.name
  }

  getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<EthereumStepExecutorContext> => {
    const {
      step,
      fromChain,
      executionOptions,
      client,
      retryParams,
      isBridgeExecution,
    } = baseContext

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      executionOptions?.disableMessageSigning || step.type !== 'lifi'

    const pipeline = new TaskPipeline([
      new EthereumCheckPermitsTask(),
      new EthereumCheckAllowanceTask(),
      new EthereumNativePermitTask(),
      new EthereumResetAllowanceTask(),
      new EthereumSetAllowanceTask(),
      new EthereumWaitForApprovalTransactionTask(),
      new CheckBalanceTask(),
      new EthereumPrepareTransactionTask(),
      new EthereumSignAndExecuteTask(),
      new EthereumWaitForTransactionTask(),
      new EthereumWaitForTransactionStatusTask(),
    ])

    const firstTaskName = this.getFirstTaskName(
      step,
      isBridgeExecution,
      isFromNativeToken
    )

    return {
      ...baseContext,
      isFromNativeToken,
      disableMessageSigning,
      getExecutionStrategy: async (step: LiFiStepExtended) => {
        return await getEthereumExecutionStrategy(
          client,
          this.client,
          step,
          fromChain,
          retryParams
        )
      },
      checkClient: this.checkClient,
      pipeline,
      firstTaskName,
      parseErrors: (
        e: Error,
        step?: LiFiStepExtended,
        action?: ExecutionAction
      ) => parseEthereumErrors(e, step, action, retryParams),
      // Payload shared between tasks
      signedTypedData: [],
      transactionRequest: undefined,
    }
  }
}
