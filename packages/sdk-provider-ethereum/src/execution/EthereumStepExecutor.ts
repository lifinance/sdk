import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TransactionError,
} from '@lifi/sdk'
import type { Client, GetAddressesReturnType } from 'viem'
import { getAddresses } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from '../errors/parseEthereumErrors.js'
import type { EthereumStepExecutorContext } from '../types.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { EthereumPermitPipeline } from './pipelines/EthereumPermitPipeline.js'
import { EthereumReceivingChainPipeline } from './pipelines/EthereumReceivingChainPipeline.js'
import { EthereumSwapOrBridgePipeline } from './pipelines/EthereumSwapOrBridgePipeline.js'
import { EthereumTokenAllowancePipeline } from './pipelines/EthereumTokenAllowancePipeline.js'
import { getEthereumExecutionStrategy } from './tasks/helpers/getEthereumExecutionStrategy.js'
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
    } = baseContext

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      executionOptions?.disableMessageSigning || step.type !== 'lifi'

    const actionPipelines = new ActionPipelineOrchestrator([
      new EthereumPermitPipeline(),
      new EthereumTokenAllowancePipeline(),
      new EthereumSwapOrBridgePipeline(isBridgeExecution),
      new EthereumReceivingChainPipeline(),
    ])

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
    }
  }
}
