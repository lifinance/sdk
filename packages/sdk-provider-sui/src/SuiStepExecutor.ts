import {
  BaseStepExecutor,
  checkBalance,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SDKClient,
  stepComparison,
  TransactionError,
  type TransactionParameters,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import {
  signAndExecuteTransaction,
  type WalletWithRequiredFeatures,
} from '@mysten/wallet-standard'
import { callSuiWithRetry } from './client/suiClient.js'
import { parseSuiErrors } from './errors/parseSuiErrors.js'
import type { SuiStepExecutorOptions } from './types.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  checkWallet = (step: LiFiStepExtended) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (
      !this.wallet.accounts?.some?.(
        (account) => account.address === step.action.fromAddress
      )
    ) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    const isBridgeExecution = step.action.fromChainId !== step.action.toChainId
    const executionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    step = this.statusManager.initExecution(step, executionType)

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    step = this.statusManager.updateExecution(step, {
      type: executionType,
      chainId: fromChain.id,
      status: 'PENDING',
    })

    const transaction = step.execution?.transactions.find(
      (t) => t.type === executionType
    )
    if (!transaction?.doneAt) {
      try {
        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'STARTED',
        })

        // Check balance
        await checkBalance(client, step.action.fromAddress!, step)

        // Create new transaction
        if (!step.transactionRequest) {
          const { execution, ...stepBase } = step
          const updatedStep = await getStepTransaction(client, stepBase)
          const comparedStep = await stepComparison(
            this.statusManager,
            step,
            updatedStep,
            this.allowUserInteraction,
            this.executionOptions
          )
          Object.assign(step, {
            ...comparedStep,
            execution: step.execution,
          })
        }

        if (!step.transactionRequest?.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'ACTION_REQUIRED',
        })

        if (!this.allowUserInteraction) {
          return step
        }

        let transactionRequest: TransactionParameters = {
          data: step.transactionRequest?.data,
        }

        if (this.executionOptions?.updateTransactionRequestHook) {
          const customizedTransactionRequest: TransactionParameters =
            await this.executionOptions.updateTransactionRequestHook({
              requestType: 'transaction',
              ...transactionRequest,
            })

          transactionRequest = {
            ...transactionRequest,
            ...customizedTransactionRequest,
          }
        }

        const transactionRequestData = transactionRequest.data

        if (!transactionRequestData) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        this.checkWallet(step)

        // We give users 2 minutes to sign the transaction
        const signedTx = await signAndExecuteTransaction(this.wallet, {
          account: this.wallet.accounts.find(
            (account) => account.address === step.action.fromAddress
          )!,
          chain: 'sui:mainnet',
          transaction: {
            toJSON: async () => transactionRequestData,
          },
        })

        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'PENDING',
        })

        const result = await callSuiWithRetry(client, (client) =>
          client.waitForTransaction({
            digest: signedTx.digest,
            options: {
              showEffects: true,
            },
          })
        )

        if (result.effects?.status.status !== 'success') {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed: ${result.effects?.status.error}`
          )
        }

        // Transaction has been confirmed and we can update the execution
        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'PENDING',
          transaction: {
            type: executionType,
            txHash: result.digest,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${result.digest}`,
          },
        })

        if (isBridgeExecution) {
          step = this.statusManager.updateExecution(step, {
            type: executionType,
            status: 'DONE',
          })
        }
      } catch (e: any) {
        const error = await parseSuiErrors(e, step, executionType)
        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'FAILED',
          error: {
            message: error.cause.message,
            code: error.code,
          },
        })
        throw error
      }
    }

    await waitForDestinationChainTransaction(
      client,
      step,
      executionType,
      fromChain,
      toChain,
      this.statusManager
    )

    return step
  }
}
