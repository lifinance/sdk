import type { ExtendedTransactionInfo, FullStatusData } from '@lifi/types'
import { type SignerWalletAdapter } from '@solana/wallet-adapter-base'
import {
  VersionedTransaction,
  type SendOptions,
  type SignatureResult,
} from '@solana/web3.js'
import { config } from '../../config.js'
import { getStepTransaction } from '../../services/api.js'
import { base64ToUint8Array } from '../../utils/base64ToUint8Array.js'
import {
  LiFiErrorCode,
  TransactionError,
  getTransactionFailedMessage,
  parseError,
} from '../../utils/index.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import { checkBalance } from '../checkBalance.js'
import { stepComparison } from '../stepComparison.js'
import type {
  LiFiStepExtended,
  StepExecutorOptions,
  TransactionParameters,
} from '../types.js'
import { getSubstatusMessage } from '../utils.js'
import { waitForReceivingTransaction } from '../waitForReceivingTransaction.js'
import { getSolanaConnection } from './connection.js'

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  walletAdapter: SignerWalletAdapter
}

const TX_RETRY_INTERVAL = 500
// https://solana.com/docs/advanced/confirmation
const TIMEOUT_PERIOD = 60_000

export class SolanaStepExecutor extends BaseStepExecutor {
  private walletAdapter: SignerWalletAdapter

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.walletAdapter = options.walletAdapter
  }

  checkWalletAdapter = (step: LiFiStepExtended) => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.walletAdapter.publicKey!.toString() !== step.action.fromAddress) {
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

    // STEP 2: Get transaction
    let process = this.statusManager.findOrCreateProcess(
      step,
      currentProcessType
    )

    if (process.status !== 'DONE') {
      try {
        const connection = await getSolanaConnection()

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'STARTED'
        )

        // Check balance
        await checkBalance(this.walletAdapter.publicKey!.toString(), step)

        // Create new transaction
        if (!step.transactionRequest) {
          const updatedStep = await getStepTransaction(step)
          const comparedStep = await stepComparison(
            this.statusManager,
            step,
            updatedStep,
            this.allowUserInteraction,
            this.executionOptions
          )
          step = {
            ...comparedStep,
            execution: step.execution,
          }
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

        const versionedTransaction = VersionedTransaction.deserialize(
          base64ToUint8Array(transactionRequest.data)
        )

        const blockhashResult = await connection.getLatestBlockhashAndContext({
          commitment: 'confirmed',
        })

        // Update transaction recent blockhash with the latest blockhash
        versionedTransaction.message.recentBlockhash =
          blockhashResult.value.blockhash

        this.checkWalletAdapter(step)

        const signedTx =
          await this.walletAdapter.signTransaction(versionedTransaction)

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )

        const rawTransactionOptions: SendOptions = {
          // Skipping preflight i.e. tx simulation by RPC as we simulated the tx above
          skipPreflight: true,
          // Setting max retries to 0 as we are handling retries manually
          // Set this manually so that the default is skipped
          maxRetries: 0,
          // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
          preflightCommitment: 'confirmed',
          // minContextSlot: blockhashResult.context.slot,
        }

        const txSignature = await connection.sendRawTransaction(
          signedTx.serialize(),
          rawTransactionOptions
        )

        // In the following section, we wait and constantly check for the transaction to be confirmed
        // and resend the transaction if it is not confirmed within a certain time interval
        // thus handling tx retries on the client side rather than relying on the RPC
        const confirmTransactionPromise = connection
          .confirmTransaction(
            {
              signature: txSignature,
              blockhash: blockhashResult.value.blockhash,
              lastValidBlockHeight: blockhashResult.value.lastValidBlockHeight,
            },
            'confirmed'
          )
          .then((result) => result.value)

        let confirmedTx: SignatureResult | null = null
        const startTime = Date.now()

        while (!confirmedTx && Date.now() - startTime <= TIMEOUT_PERIOD) {
          confirmedTx = await Promise.race([
            confirmTransactionPromise,
            new Promise<null>((resolve) =>
              setTimeout(() => {
                resolve(null)
              }, TX_RETRY_INTERVAL)
            ),
          ])
          if (confirmedTx) {
            break
          }

          await connection.sendRawTransaction(
            signedTx.serialize(),
            rawTransactionOptions
          )
        }

        if (confirmedTx?.err) {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed: ${confirmedTx?.err}`
          )
        }

        if (!confirmedTx) {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            'Failed to land the transaction'
          )
        }

        // Transaction has been confirmed and we can update the process
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING',
          {
            txHash: txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txSignature}`,
          }
        )

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseError(e, step, process)
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'FAILED',
          {
            error: {
              message: error.message,
              htmlMessage: error.htmlMessage,
              code: error.code,
            },
          }
        )
        this.statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    // STEP 5: Wait for the receiving chain
    if (isBridgeExecution) {
      process = this.statusManager.findOrCreateProcess(
        step,
        'RECEIVING_CHAIN',
        'PENDING'
      )
    }
    let statusResponse: FullStatusData
    try {
      if (!process.txHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = (await waitForReceivingTransaction(
        process.txHash,
        this.statusManager,
        process.type,
        step
      )) as FullStatusData

      const statusReceiving =
        statusResponse.receiving as ExtendedTransactionInfo

      process = this.statusManager.updateProcess(step, process.type, 'DONE', {
        substatus: statusResponse.substatus,
        substatusMessage:
          statusResponse.substatusMessage ||
          getSubstatusMessage(statusResponse.status, statusResponse.substatus),
        txHash: statusReceiving?.txHash,
        txLink: `${toChain.metamask.blockExplorerUrls[0]}tx/${statusReceiving?.txHash}`,
      })

      this.statusManager.updateExecution(step, 'DONE', {
        fromAmount: statusResponse.sending.amount,
        toAmount: statusReceiving?.amount,
        toToken: statusReceiving?.token,
        gasCosts: [
          {
            amount: statusResponse.sending.gasAmount,
            amountUSD: statusResponse.sending.gasAmountUSD,
            token: statusResponse.sending.gasToken,
            estimate: statusResponse.sending.gasUsed,
            limit: statusResponse.sending.gasUsed,
            price: statusResponse.sending.gasPrice,
            type: 'SEND',
          },
        ],
      })
    } catch (e: unknown) {
      const htmlMessage = await getTransactionFailedMessage(
        step,
        process.txLink
      )

      process = this.statusManager.updateProcess(step, process.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message: 'Failed while waiting for receiving chain.',
          htmlMessage,
        },
      })
      this.statusManager.updateExecution(step, 'FAILED')
      console.warn(e)
      throw e
    }

    // DONE
    return step
  }
}
