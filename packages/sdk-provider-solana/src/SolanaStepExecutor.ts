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
  getBase64EncodedWireTransaction,
  getTransactionCodec,
} from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'
import { sendAndConfirmTransaction } from './actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from './client/connection.js'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import type { SolanaStepExecutorOptions } from './types.js'
import { base64ToUint8Array } from './utils/base64ToUint8Array.js'
import { getWalletFeature } from './utils/getWalletFeature.js'
import { withTimeout } from './utils/withTimeout.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet
  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  checkWalletAdapter = async (step: LiFiStepExtended) => {
    if (!this.wallet.features[SolanaSignTransaction]) {
      throw new TransactionError(
        LiFiErrorCode.ProviderUnavailable,
        'Wallet does not support signing transactions.'
      )
    }

    const accountWithSignerAddress = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )

    if (!accountWithSignerAddress) {
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
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    const walletAccount = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )

    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'Wallet account not found for the specified address.'
      )
    }

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
        await checkBalance(client, walletAccount.address, step)

        // Create new transaction
        if (!step.transactionRequest) {
          // biome-ignore lint/correctness/noUnusedVariables: destructuring
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

        if (!transactionRequest.data) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction.'
          )
        }

        const transactionBytes = base64ToUint8Array(transactionRequest.data)

        await this.checkWalletAdapter(step)

        const signedTransactionOutputs = await withTimeout(
          async () => {
            const { signTransaction } = getWalletFeature(
              this.wallet,
              SolanaSignTransaction
            )
            return signTransaction({
              account: walletAccount,
              transaction: transactionBytes,
            })
          },
          {
            // https://solana.com/docs/advanced/confirmation#transaction-expiration
            // Use 2 minutes to account for fluctuations
            timeout: 120_000,
            errorInstance: new TransactionError(
              LiFiErrorCode.TransactionExpired,
              'Transaction has expired: blockhash is no longer recent enough.'
            ),
          }
        )

        if (signedTransactionOutputs.length === 0) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'No signed transaction returned from signer.'
          )
        }

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )

        const transactionCodec = getTransactionCodec()

        const signedTransaction = transactionCodec.decode(
          signedTransactionOutputs[0].signedTransaction
        )

        const encodedTransaction =
          getBase64EncodedWireTransaction(signedTransaction)

        const simulationResult = await callSolanaWithRetry(
          client,
          (connection) =>
            connection
              .simulateTransaction(encodedTransaction, {
                commitment: 'confirmed',
                replaceRecentBlockhash: true,
                encoding: 'base64',
              })
              .send()
        )

        if (simulationResult.value.err) {
          throw new TransactionError(
            LiFiErrorCode.TransactionSimulationFailed,
            'Transaction simulation failed'
          )
        }

        const confirmedTransaction = await sendAndConfirmTransaction(
          client,
          signedTransaction
        )

        if (!confirmedTransaction.signatureResult) {
          throw new TransactionError(
            LiFiErrorCode.TransactionExpired,
            'Transaction has expired: The block height has exceeded the maximum allowed limit.'
          )
        }

        if (confirmedTransaction.signatureResult.err) {
          const reason =
            typeof confirmedTransaction.signatureResult.err === 'object'
              ? JSON.stringify(confirmedTransaction.signatureResult.err)
              : confirmedTransaction.signatureResult.err
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed: ${reason}`
          )
        }

        // Transaction has been confirmed and we can update the process
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING',
          {
            txHash: confirmedTransaction.txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
          }
        )

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseSolanaErrors(e, step, process)
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'FAILED',
          {
            error: {
              message: error.cause.message,
              code: error.code,
            },
          }
        )
        this.statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    await waitForDestinationChainTransaction(
      client,
      step,
      process,
      fromChain,
      toChain,
      this.statusManager
    )

    // DONE
    return step
  }
}
