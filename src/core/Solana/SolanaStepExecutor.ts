import type { ExtendedTransactionInfo, FullStatusData } from '@lifi/types'
import { type SignerWalletAdapter } from '@solana/wallet-adapter-base'
import {
  VersionedTransaction,
  type SendOptions,
  type SignatureResult,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { withTimeout } from 'viem'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getStepTransaction } from '../../services/api.js'
import { base64ToUint8Array } from '../../utils/base64ToUint8Array.js'
import { getTransactionFailedMessage } from '../../utils/index.js'
import { sleep } from '../../utils/sleep.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import { checkBalance } from '../checkBalance.js'
import { getSubstatusMessage } from '../processMessages.js'
import { stepComparison } from '../stepComparison.js'
import type {
  LiFiStepExtended,
  StepExecutorOptions,
  TransactionParameters,
} from '../types.js'
import { waitForReceivingTransaction } from '../waitForReceivingTransaction.js'
import { getSolanaConnection } from './connection.js'
import { parseSolanaErrors } from './parseSolanaErrors.js'

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  walletAdapter: SignerWalletAdapter
}

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
          const { execution, ...stepBase } = step
          const updatedStep = await getStepTransaction(stepBase)
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

        const blockhashResult = await connection.getLatestBlockhash({
          commitment: 'confirmed',
        })

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

        this.checkWalletAdapter(step)

        // We give users 2 minutes to sign the transaction or it should be considered expired
        const signedTx = await withTimeout<VersionedTransaction>(
          () => this.walletAdapter.signTransaction(versionedTransaction),
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

        process = this.statusManager.updateProcess(
          step,
          process.type,
          'PENDING'
        )

        const simulationResult = await connection.simulateTransaction(
          signedTx,
          {
            commitment: 'processed',
            replaceRecentBlockhash: true,
          }
        )

        if (simulationResult.value.err) {
          throw new TransactionError(
            LiFiErrorCode.TransactionSimulationFailed,
            'Transaction simulation failed'
          )
        }

        // Create transaction hash (signature)
        const txSignature = bs58.encode(signedTx.signatures[0])

        // A known weirdness - MAX_RECENT_BLOCKHASHES is 300
        // https://github.com/solana-labs/solana/blob/master/sdk/program/src/clock.rs#L123
        // but MAX_PROCESSING_AGE is 150
        // https://github.com/solana-labs/solana/blob/master/sdk/program/src/clock.rs#L129
        // the blockhash queue in the bank tells you 300 + current slot, but it won't be accepted 150 blocks later.
        // https://solana.com/docs/advanced/confirmation#transaction-expiration
        const lastValidBlockHeight = blockhashResult.lastValidBlockHeight - 150

        // In the following section, we wait and constantly check for the transaction to be confirmed
        // and resend the transaction if it is not confirmed within a certain time interval
        // thus handling tx retries on the client side rather than relying on the RPC
        const abortController = new AbortController()
        const confirmTransactionPromise = connection
          .confirmTransaction(
            {
              signature: txSignature,
              blockhash: blockhashResult.blockhash,
              lastValidBlockHeight: lastValidBlockHeight,
              abortSignal: abortController.signal,
            },
            'confirmed'
          )
          .then((result) => result.value)

        let confirmedTx: SignatureResult | null = null
        let blockHeight = await connection.getBlockHeight()

        const rawTransactionOptions: SendOptions = {
          // We can skip preflight check after the first transaction has been sent
          // https://solana.com/docs/advanced/retry#the-cost-of-skipping-preflight
          skipPreflight: true,
          // Setting max retries to 0 as we are handling retries manually
          maxRetries: 0,
          // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
          preflightCommitment: 'confirmed',
        }

        const signedTxSerialized = signedTx.serialize()

        // https://solana.com/docs/advanced/retry#customizing-rebroadcast-logic
        while (!confirmedTx && blockHeight < lastValidBlockHeight) {
          await connection.sendRawTransaction(
            signedTxSerialized,
            rawTransactionOptions
          )
          confirmedTx = await Promise.race([
            confirmTransactionPromise,
            sleep(1000),
          ])
          if (confirmedTx) {
            break
          }
          blockHeight = await connection.getBlockHeight()
        }

        // Stop waiting for tx confirmation
        abortController.abort()

        if (!confirmedTx) {
          throw new TransactionError(
            LiFiErrorCode.TransactionExpired,
            'Transaction has expired: The block height has exceeded the maximum allowed limit.'
          )
        }

        if (confirmedTx?.err) {
          const reason =
            typeof confirmedTx.err === 'object'
              ? JSON.stringify(confirmedTx.err)
              : confirmedTx.err
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
            txHash: txSignature,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txSignature}`,
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

    // STEP 5: Wait for the receiving chain
    const processTxHash = process.txHash
    if (isBridgeExecution) {
      process = this.statusManager.findOrCreateProcess(
        step,
        'RECEIVING_CHAIN',
        'PENDING'
      )
    }
    let statusResponse: FullStatusData
    try {
      if (!processTxHash) {
        throw new Error('Transaction hash is undefined.')
      }
      statusResponse = (await waitForReceivingTransaction(
        processTxHash,
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
