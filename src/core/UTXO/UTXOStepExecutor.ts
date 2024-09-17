import {
  ChainId,
  type ExtendedTransactionInfo,
  type FullStatusData,
} from '@lifi/types'
import { address, networks, Psbt } from 'bitcoinjs-lib'
import { withRetry, withTimeout, type Client } from 'viem'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getStepTransaction } from '../../services/api.js'
import {
  getTransactionFailedMessage,
  waitForResult,
} from '../../utils/index.js'
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
import { getUTXOPublicClient } from './getUTXOPublicClient.js'
import { parseUTXOErrors } from './parseUTXOErrors.js'
import { signPsbt } from './utxo-stack/actions/signPsbt.js'
import {
  waitForTransaction,
  type ReplacementReason,
} from './utxo-stack/actions/waitForTransaction.js'

export interface UTXOStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class UTXOStepExecutor extends BaseStepExecutor {
  private client: Client

  constructor(options: UTXOStepExecutorOptions) {
    super(options)
    this.client = options.client
  }

  checkClient = (step: LiFiStepExtended) => {
    // TODO: check chain and possibly implement chain switch?
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.client.account?.address !== step.action.fromAddress) {
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

    const publicClient = await getUTXOPublicClient(ChainId.BTC)

    if (process.status !== 'DONE') {
      try {
        let txHash: string
        if (process.txHash) {
          // Make sure that the chain is still correct
          this.checkClient(step)

          // Wait for exiting transaction
          txHash = process.txHash
        } else {
          process = this.statusManager.updateProcess(
            step,
            process.type,
            'STARTED'
          )

          // Check balance
          await checkBalance(this.client.account!.address, step)

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

          this.checkClient(step)

          // const toolbox = getToolboxByChain('BTC')({})

          // const apiClient = blockchairApi({ chain: 'BTC' as UTXOChain })
          // const txFeeRate = await apiClient.getSuggestedTxFee()

          // const tx = await toolbox.buildTx({
          //   assetValue: {
          //     bigIntValue: step.transactionRequest.value,
          //   },
          //   recipient: step.transactionRequest.to,
          //   memo: step.transactionRequest.data,
          //   sender: this.client.account?.address,
          //   chain: 'BTC',
          //   apiClient: blockchairApi({ chain: 'BTC' as UTXOChain }),
          //   feeRate: txFeeRate * 0.75,
          // })

          // const tx2 = await toolbox.buildTx({
          //   assetValue: {
          //     bigIntValue: step.transactionRequest.value,
          //   },
          //   recipient: step.transactionRequest.to,
          //   memo: step.transactionRequest.data,
          //   sender: this.client.account?.address,
          //   chain: 'BTC',
          //   apiClient: blockchairApi({ chain: 'BTC' as UTXOChain }),
          //   feeRate: txFeeRate * 1.25,
          // })

          let psbtHex = transactionRequest.data // tx.psbt.toHex()

          const psbt = Psbt.fromHex(psbtHex, { network: networks.bitcoin })

          const inputsToSign = Array.from(
            psbt.data.inputs
              .reduce((map, input, index) => {
                const accountAddress = input.witnessUtxo
                  ? address.fromOutputScript(
                      input.witnessUtxo.script,
                      networks.bitcoin
                    )
                  : (this.client.account?.address as string)
                if (map.has(accountAddress)) {
                  map.get(accountAddress).signingIndexes.push(index)
                } else {
                  map.set(accountAddress, {
                    address: accountAddress,
                    sigHash: 1, // Default to Transaction.SIGHASH_ALL - 1
                    signingIndexes: [index],
                  })
                }
                return map
              }, new Map())
              .values()
          )

          psbtHex = psbt.toHex()

          // We give users 10 minutes to sign the transaction or it should be considered expired
          const signedPsbtHex = await withTimeout(
            () =>
              signPsbt(this.client, {
                psbt: psbtHex,
                inputsToSign: inputsToSign,
                finalize: false,
              }),
            {
              timeout: 600_000,
              errorInstance: new TransactionError(
                LiFiErrorCode.TransactionExpired,
                'Transaction has expired.'
              ),
            }
          )

          const signedPsbt = Psbt.fromHex(signedPsbtHex).finalizeAllInputs()

          const transactionHex = signedPsbt.extractTransaction().toHex()

          txHash = await publicClient.sendUTXOTransaction({
            hex: transactionHex,
          })

          process = this.statusManager.updateProcess(
            step,
            process.type,
            'PENDING',
            {
              txHash: txHash,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
            }
          )
        }

        let replacementReason: ReplacementReason | undefined
        const transaction = await waitForTransaction(publicClient, {
          txId: txHash,
          senderAddress: this.client.account?.address,
          onReplaced: (response) => {
            replacementReason = response.reason
            process = this.statusManager.updateProcess(
              step,
              process.type,
              'PENDING',
              {
                txHash: response.transaction.txid,
                txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.txid}`,
              }
            )
          },
        })

        if (replacementReason === 'cancelled') {
          throw new TransactionError(
            LiFiErrorCode.TransactionCanceled,
            'User canceled transaction.'
          )
        }

        // TODO: improve logic to detect RBF transactions
        await waitForResult(
          () =>
            withRetry(
              async () => {
                const tx = await publicClient.getUTXOTransaction({
                  txId: txHash,
                })
                // If there are no confirmations, it means the transaction is still in the mempool
                if (!tx.confirmations) {
                  return
                }
                return tx
              },
              {
                retryCount: 10,
                delay: 1000,
              }
            ),
          10_000
        )

        if (transaction.txid !== txHash) {
          process = this.statusManager.updateProcess(
            step,
            process.type,
            'PENDING',
            {
              txHash: transaction.txid,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transaction.txid}`,
            }
          )
        }

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseUTXOErrors(e, step, process)
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
        step,
        10_000
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
