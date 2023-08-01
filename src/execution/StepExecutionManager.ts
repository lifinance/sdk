import type {
  Execution,
  ExtendedTransactionInfo,
  FullStatusData,
} from '@lifi/types'
import type { Address, Hash, PublicClient, ReplacementReason } from 'viem'
import { publicActions } from 'viem'
import ApiService from '../services/ApiService'
import ChainsService from '../services/ChainsService'
import ConfigService from '../services/ConfigService'
import type {
  BaseTransaction,
  ExecutionParams,
  TransactionRequest,
} from '../types'
import { getMaxPriorityFeePerGas } from '../utils'
import {
  LiFiErrorCode,
  TransactionError,
  ValidationError,
} from '../utils/errors'
import { getTransactionFailedMessage, parseError } from '../utils/parseError'
import { isZeroAddress } from '../utils/utils'
import { checkAllowance } from './checkAllowance'
import { checkBalance } from './checkBalance'
import { updateMultisigRouteProcess } from './multisig'
import { stepComparison } from './stepComparison'
import { switchChain } from './switchChain'
import { getSubstatusMessage } from './utils'
import { waitForReceivingTransaction } from './waitForReceivingTransaction'

export class StepExecutionManager {
  allowUserInteraction = true

  allowInteraction = (value: boolean): void => {
    this.allowUserInteraction = value
  }

  execute = async ({
    walletClient,
    step,
    statusManager,
    settings,
  }: ExecutionParams): Promise<Execution> => {
    const client = walletClient.extend(publicActions)
    const config = ConfigService.getInstance().getConfig()

    const isMultisigWalletClient = !!config.multisig?.isMultisigWalletClient
    const multisigBatchTransactions: BaseTransaction[] = []

    const shouldBatchTransactions =
      config.multisig?.shouldBatchTransactions &&
      !!config.multisig.sendBatchTransaction

    step.execution = statusManager.initExecutionObject(step)

    const chainsService = ChainsService.getInstance()
    const fromChain = await chainsService.getChainById(step.action.fromChainId)
    const toChain = await chainsService.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    // STEP 1: Check allowance
    const existingProcess = step.execution.process.find(
      (p) => p.type === currentProcessType
    )

    // Check token approval only if fromToken is not the native token => no approval needed in that case

    const checkForAllowance =
      !existingProcess?.txHash &&
      !isZeroAddress(step.action.fromToken.address) &&
      (shouldBatchTransactions || !isMultisigWalletClient)

    if (checkForAllowance) {
      const data = await checkAllowance(
        client,
        step,
        statusManager,
        settings,
        fromChain,
        this.allowUserInteraction,
        shouldBatchTransactions
      )

      if (data) {
        // allowance doesn't need value
        const baseTransaction: BaseTransaction = {
          to: step.action.fromToken.address,
          data,
        }

        multisigBatchTransactions.push(baseTransaction)
      }
    }

    // STEP 2: Get transaction
    let process = statusManager.findOrCreateProcess(step, currentProcessType)

    if (process.status !== 'DONE') {
      const multisigProcess = step.execution.process.find(
        (p) => !!p.multisigTxHash
      )

      try {
        if (isMultisigWalletClient && multisigProcess) {
          const multisigTxHash = multisigProcess.multisigTxHash as Hash
          if (!multisigTxHash) {
            throw new ValidationError(
              'Multisig internal transaction hash is undefined.'
            )
          }
          await updateMultisigRouteProcess(
            multisigTxHash,
            step,
            statusManager,
            process.type,
            fromChain
          )
        }

        let txHash: Hash
        if (process.txHash) {
          // Make sure that the chain is still correct
          const updatedWalletClient = await switchChain(
            walletClient,
            statusManager,
            step,
            settings.switchChainHook,
            this.allowUserInteraction
          )

          if (!updatedWalletClient) {
            // Chain switch was not successful, stop execution here
            return step.execution
          }

          walletClient = updatedWalletClient

          // Load exiting transaction
          txHash = process.txHash as Hash
        } else {
          process = statusManager.updateProcess(step, process.type, 'STARTED')

          // Check balance
          await checkBalance(client.account!.address, step)

          // Create new transaction
          if (!step.transactionRequest) {
            const updatedStep = await ApiService.getStepTransaction(step)
            const comparedStep = await stepComparison(
              statusManager,
              step,
              updatedStep,
              settings,
              this.allowUserInteraction
            )
            step = {
              ...comparedStep,
              execution: step.execution,
            }
          }

          let transactionRequest: TransactionRequest = {
            to: step.transactionRequest?.to as Hash,
            from: step.transactionRequest?.from as Hash,
            data: step.transactionRequest?.data as Hash,
            value: step.transactionRequest?.value
              ? BigInt(step.transactionRequest.value as string)
              : undefined,
            maxPriorityFeePerGas:
              walletClient.account?.type === 'local'
                ? await getMaxPriorityFeePerGas(client as PublicClient)
                : undefined,
            // gas: step.transactionRequest?.gasLimit
            //   ? BigInt(step.transactionRequest.gasLimit as string)
            //   : undefined,
            // gasPrice: step.transactionRequest?.gasPrice
            //   ? BigInt(step.transactionRequest.gasPrice as string)
            //   : undefined,
            // maxFeePerGas: step.transactionRequest?.maxFeePerGas
            //   ? BigInt(step.transactionRequest.maxFeePerGas as string)
            //   : undefined,
            // maxPriorityFeePerGas: step.transactionRequest?.maxPriorityFeePerGas
            //   ? BigInt(step.transactionRequest.maxPriorityFeePerGas as string)
            //   : undefined,
          }

          if (!transactionRequest) {
            throw new TransactionError(
              LiFiErrorCode.TransactionUnprepared,
              'Unable to prepare transaction.'
            )
          }

          // STEP 3: Send the transaction
          // Make sure that the chain is still correct
          const updatedWalletClient = await switchChain(
            walletClient,
            statusManager,
            step,
            settings.switchChainHook,
            this.allowUserInteraction
          )

          if (!updatedWalletClient) {
            // Chain switch was not successful, stop execution here
            return step.execution!
          }

          walletClient = updatedWalletClient

          process = statusManager.updateProcess(
            step,
            process.type,
            'ACTION_REQUIRED'
          )

          if (!this.allowUserInteraction) {
            return step.execution!
          }

          if (settings.updateTransactionRequestHook) {
            const customizedTransactionRequest: TransactionRequest =
              await settings.updateTransactionRequestHook(transactionRequest)

            transactionRequest = {
              ...transactionRequest,
              ...customizedTransactionRequest,
            }
          }

          if (
            shouldBatchTransactions &&
            config.multisig?.sendBatchTransaction
          ) {
            if (transactionRequest.to && transactionRequest.data) {
              const populatedTransaction: BaseTransaction = {
                value: transactionRequest.value,
                to: transactionRequest.to,
                data: transactionRequest.data,
              }
              multisigBatchTransactions.push(populatedTransaction)

              txHash = await config.multisig?.sendBatchTransaction(
                multisigBatchTransactions
              )
            } else {
              throw new TransactionError(
                LiFiErrorCode.TransactionUnprepared,
                'Unable to prepare transaction.'
              )
            }
          } else {
            txHash = await walletClient.sendTransaction({
              to: transactionRequest.to as Address,
              account: walletClient.account!,
              data: transactionRequest.data,
              maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
              chain: null,
            })
          }

          // STEP 4: Wait for the transaction
          if (isMultisigWalletClient) {
            process = statusManager.updateProcess(
              step,
              process.type,
              'ACTION_REQUIRED',
              {
                multisigTxHash: txHash,
              }
            )
          } else {
            process = statusManager.updateProcess(
              step,
              process.type,
              'PENDING',
              {
                txHash: txHash,
                txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
              }
            )
          }
        }

        let replacementReason: ReplacementReason | undefined
        const transactionReceipt = await client.waitForTransactionReceipt({
          hash: txHash,
          onReplaced(response) {
            replacementReason = response.reason
            statusManager.updateProcess(step, process.type, 'PENDING', {
              txHash: response.transaction.hash,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
            })
          },
        })

        if (replacementReason === 'cancelled') {
          throw new TransactionError(
            LiFiErrorCode.TransactionCanceled,
            'User canceled transaction.'
          )
        }

        // if it's multisig wallet client and the process is in ACTION_REQUIRED
        // then signatures are still needed
        if (isMultisigWalletClient && process.status === 'ACTION_REQUIRED') {
          await updateMultisigRouteProcess(
            transactionReceipt.transactionHash,
            step,
            statusManager,
            process.type,
            fromChain
          )
        }

        if (!isMultisigWalletClient) {
          process = statusManager.updateProcess(step, process.type, 'PENDING', {
            txHash: transactionReceipt.transactionHash,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transactionReceipt.transactionHash}`,
          })
        }

        if (isBridgeExecution) {
          process = statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseError(e, step, process)
        process = statusManager.updateProcess(step, process.type, 'FAILED', {
          error: {
            message: error.message,
            htmlMessage: error.htmlMessage,
            code: error.code,
          },
        })
        statusManager.updateExecution(step, 'FAILED')
        throw error
      }
    }

    // STEP 5: Wait for the receiving chain
    const processTxHash = process.txHash
    if (isBridgeExecution) {
      process = statusManager.findOrCreateProcess(
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
        statusManager,
        process.type,
        step
      )) as FullStatusData

      const statusReceiving =
        statusResponse.receiving as ExtendedTransactionInfo

      process = statusManager.updateProcess(step, process.type, 'DONE', {
        substatus: statusResponse.substatus,
        substatusMessage:
          statusResponse.substatusMessage ||
          getSubstatusMessage(statusResponse.status, statusResponse.substatus),
        txHash: statusReceiving?.txHash,
        txLink: `${toChain.metamask.blockExplorerUrls[0]}tx/${statusReceiving?.txHash}`,
      })

      statusManager.updateExecution(step, 'DONE', {
        fromAmount: statusResponse.sending.amount,
        toAmount: statusReceiving?.amount,
        toToken: statusReceiving?.token,
        gasAmount: statusResponse.sending.gasAmount,
        gasAmountUSD: statusResponse.sending.gasAmountUSD,
        gasPrice: statusResponse.sending.gasPrice,
        gasToken: statusResponse.sending.gasToken,
        gasUsed: statusResponse.sending.gasUsed,
      })
    } catch (e: unknown) {
      const htmlMessage = await getTransactionFailedMessage(
        step,
        process.txLink
      )

      process = statusManager.updateProcess(step, process.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message: 'Failed while waiting for receiving chain.',
          htmlMessage,
        },
      })
      statusManager.updateExecution(step, 'FAILED')
      console.warn(e)
      throw e
    }

    // DONE
    return step.execution!
  }
}
