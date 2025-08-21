import type { Adapter } from '@tronweb3/tronwallet-abstract-adapter'
import { TronWeb } from 'tronweb'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getStepTransaction } from '../../services/api.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import { checkBalance } from '../checkBalance.js'
import { stepComparison } from '../stepComparison.js'
import type { LiFiStepExtended, TransactionParameters } from '../types.js'
import { waitForDestinationChainTransaction } from '../waitForDestinationChainTransaction.js'
import type { TronStepExecutorOptions } from './types.js'
export class TronStepExecutor extends BaseStepExecutor {
  private wallet: Adapter
  private tronWeb: TronWeb

  constructor(options: TronStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
    // Initialize TronWeb with default nodes
    this.tronWeb = new TronWeb({
      fullNode: 'https://api.trongrid.io',
    })
  }

  checkWallet = (step: LiFiStepExtended) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.wallet.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  executeStep = async (step: LiFiStepExtended): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await config.getChainById(step.action.fromChainId)
    const toChain = await config.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    let process = this.statusManager.findOrCreateProcess({
      step,
      type: currentProcessType,
      chainId: fromChain.id,
    })

    if (process.status !== 'DONE') {
      try {
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'STARTED'
        )

        // Check balance
        await checkBalance(step.action.fromAddress!, step)

        // Create new transaction
        if (!step.transactionRequest) {
          // biome-ignore lint/correctness/noUnusedVariables: destructuring
          const { execution, ...stepBase } = step
          const updatedStep = await getStepTransaction(stepBase)
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

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'ACTION_REQUIRED'
        )

        if (!this.allowUserInteraction) {
          return step
        }

        let transactionRequest: TransactionParameters = {
          data: step.transactionRequest.data,
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
        const signedTx = await this.wallet.signTransaction(
          transactionRequestData // TODO: map formats
        )

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )

        // Broadcast the signed transaction
        const result = await this.tronWeb.trx.sendRawTransaction(signedTx)

        if (!result.result) {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed: ${result.message || 'Unknown error'}`
          )
        }

        // Transaction has been confirmed and we can update the process
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING',
          {
            txHash: result.txid,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${result.txid}`,
          }
        )

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Transaction failed: ${e.message || 'Unknown error'}`
        )
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'FAILED',
          {
            error: {
              message: error.message,
              code: error.code,
            },
          }
        )
        this.statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    await waitForDestinationChainTransaction(
      step,
      process,
      fromChain,
      toChain,
      this.statusManager
    )

    return step
  }
}
