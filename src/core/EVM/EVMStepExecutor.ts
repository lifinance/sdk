import type {
  ExtendedTransactionInfo,
  FullStatusData,
  Process,
} from '@lifi/types'
import type {
  Address,
  Client,
  Hash,
  Hex,
  SendTransactionParameters,
  TransactionReceipt,
} from 'viem'
import { encodeFunctionData, multicall3Abi } from 'viem'
import { estimateGas, getAddresses, sendTransaction } from 'viem/actions'
import { getCapabilities, sendCalls } from 'viem/experimental'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getStepTransaction } from '../../services/api.js'
import { getTransactionFailedMessage } from '../../utils/getTransactionMessage.js'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
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
import { checkAllowance } from './checkAllowance.js'
import { getNativePermit } from './getNativePermit.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { signPermitMessage } from './signPermitMessage.js'
import { switchChain } from './switchChain.js'
import { getMaxPriorityFeePerGas, getMulticallAddress } from './utils.js'
import {
  type WalletCallReceipt,
  waitForBatchTransactionReceipt,
} from './waitForBatchTransactionReceipt.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export type Call = {
  data?: Hex
  to?: Address
  value?: bigint
  chainId?: number
}

export type Aggregate3Call = {
  allowFailure: boolean
  callData: Hex
  target: Address
}

export interface EVMStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class EVMStepExecutor extends BaseStepExecutor {
  private client: Client

  constructor(options: EVMStepExecutorOptions) {
    super(options)
    this.client = options.client
  }

  // Ensure that we are using the right chain and wallet when executing transactions.
  checkClient = async (step: LiFiStepExtended, process?: Process) => {
    const updatedClient = await switchChain(
      this.client,
      this.statusManager,
      step,
      this.allowUserInteraction,
      this.executionOptions?.switchChainHook
    )
    if (updatedClient) {
      this.client = updatedClient
    }

    // Prevent execution of the quote by wallet different from the one which requested the quote
    let accountAddress = this.client.account?.address
    if (!accountAddress) {
      const accountAddresses = await getAddresses(this.client)
      accountAddress = accountAddresses?.[0]
    }
    if (accountAddress !== step.action.fromAddress) {
      let processToUpdate = process
      if (!processToUpdate) {
        // We need to create some process if we don't have one so we can show the error
        processToUpdate = this.statusManager.findOrCreateProcess({
          step,
          type: 'TRANSACTION',
        })
      }
      const errorMessage =
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      this.statusManager.updateProcess(step, processToUpdate.type, 'FAILED', {
        error: {
          code: LiFiErrorCode.WalletChangedDuringExecution,
          message: errorMessage,
        },
      })
      this.statusManager.updateExecution(step, 'FAILED')
      throw await parseEVMErrors(
        new TransactionError(
          LiFiErrorCode.WalletChangedDuringExecution,
          errorMessage
        ),
        step,
        process
      )
    }
    return updatedClient
  }

  executeStep = async (step: LiFiStepExtended): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    // Find if it's bridging and the step is waiting for a transaction on the receiving chain
    const recievingChainProcess = step.execution?.process.find(
      (process) => process.type === 'RECEIVING_CHAIN'
    )

    // Make sure that the chain is still correct
    // If the step is waiting for a transaction on the receiving chain, we do not switch the chain
    // All changes are already done from the source chain
    // Return the step
    if (recievingChainProcess?.substatus !== 'WAIT_DESTINATION_TRANSACTION') {
      const updatedClient = await this.checkClient(step)
      if (!updatedClient) {
        return step
      }
    }

    const fromChain = await config.getChainById(step.action.fromChainId)
    const toChain = await config.getChainById(step.action.toChainId)

    const multicallAddress = await getMulticallAddress(fromChain.id)
    const multicallSupported = !!multicallAddress

    let atomicBatchSupported = false
    try {
      const capabilities = await getCapabilities(this.client)
      atomicBatchSupported = capabilities[fromChain.id]?.atomicBatch?.supported
    } catch {
      // If the wallet does not support getCapabilities, we assume that atomic batch is not supported
    }

    const calls: Call[] = []
    const multicallCalls: Aggregate3Call[] = []

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    // STEP 1: Check allowance
    const existingProcess = step.execution.process.find(
      (p) => p.type === currentProcessType
    )

    // Check if token requires approval
    // Native tokens (like ETH) don't need approval since they're not ERC20 tokens
    // We should support different permit types:
    // 1. Native permits (EIP-2612)
    // 2. Permit2 - Universal permit implementation by Uniswap (limited to certain chains)
    // 3. Standard ERC20 approval
    const nativePermit = await getNativePermit(
      this.client,
      fromChain,
      step.action.fromToken.address as Address
    )
    // Check if proxy contract is available and token supports native permits, not available for atomic batch
    const nativePermitSupported =
      !!fromChain.permit2Proxy &&
      nativePermit.supported &&
      !atomicBatchSupported
    // Check if chain has Permit2 contract deployed, not available for atomic batch
    const permit2Supported =
      !!fromChain.permit2 && !!fromChain.permit2Proxy && !atomicBatchSupported
    // Token supports either native permits or Permit2
    const permitSupported = permit2Supported || nativePermitSupported

    // We need to check allowance only if:
    // 1. No existing transaction is pending
    // 2. Token is not native (address is not zero)
    // 3. Token doesn't support native permits (we'll use permit instead of approve)
    const checkForAllowance =
      !existingProcess?.txHash &&
      !isZeroAddress(step.action.fromToken.address) &&
      !nativePermitSupported
    // TODO: wait for existing approval tx hash?
    if (checkForAllowance) {
      // Check if token needs approval and get approval transaction data if atomic batch is supported
      const data = await checkAllowance(
        this.client,
        fromChain,
        step,
        this.statusManager,
        this.executionOptions,
        this.allowUserInteraction,
        atomicBatchSupported || multicallSupported,
        permit2Supported
      )

      if (data) {
        // Create approval transaction call
        // No value needed since we're only approving ERC20 tokens
        if (multicallSupported) {
          multicallCalls.push({
            target: step.action.fromToken.address as Address,
            callData: data,
            allowFailure: true,
          })
        } else if (atomicBatchSupported) {
          calls.push({
            chainId: step.action.fromToken.chainId,
            to: step.action.fromToken.address as Address,
            data,
          })
        }
      }
    }

    // STEP 2: Get transaction
    let process = this.statusManager.findOrCreateProcess({
      step,
      type: currentProcessType,
      chainId: fromChain.id,
    })

    if (process.status !== 'DONE') {
      try {
        let txHash: Hash
        if (process.txHash) {
          // Make sure that the chain is still correct
          const updatedClient = await this.checkClient(step, process)
          if (!updatedClient) {
            return step
          }

          // Wait for exiting transaction
          txHash = process.txHash as Hash
        } else {
          process = this.statusManager.updateProcess(
            step,
            process.type,
            'STARTED'
          )

          // Check balance
          await checkBalance(this.client.account!.address, step)

          // Create new transaction request
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
            Object.assign(step, {
              ...comparedStep,
              execution: step.execution,
            })
          }

          if (!step.transactionRequest) {
            throw new TransactionError(
              LiFiErrorCode.TransactionUnprepared,
              'Unable to prepare transaction.'
            )
          }

          let transactionRequest: TransactionParameters = {
            to: step.transactionRequest.to,
            from: step.transactionRequest.from,
            data: step.transactionRequest.data,
            value: step.transactionRequest.value
              ? BigInt(step.transactionRequest.value)
              : undefined,
            gas: step.transactionRequest.gasLimit
              ? BigInt(step.transactionRequest.gasLimit)
              : undefined,
            // gasPrice: step.transactionRequest.gasPrice
            //   ? BigInt(step.transactionRequest.gasPrice as string)
            //   : undefined,
            // maxFeePerGas: step.transactionRequest.maxFeePerGas
            //   ? BigInt(step.transactionRequest.maxFeePerGas as string)
            //   : undefined,
            maxPriorityFeePerGas:
              this.client.account?.type === 'local'
                ? await getMaxPriorityFeePerGas(this.client)
                : step.transactionRequest.maxPriorityFeePerGas
                  ? BigInt(step.transactionRequest.maxPriorityFeePerGas)
                  : undefined,
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

          // STEP 3: Send the transaction
          // Make sure that the chain is still correct
          const updatedClient = await this.checkClient(step, process)
          if (!updatedClient) {
            return step
          }

          process = this.statusManager.updateProcess(
            step,
            process.type,
            'ACTION_REQUIRED'
          )

          if (!this.allowUserInteraction) {
            return step
          }

          if (atomicBatchSupported) {
            const transferCall: Call = {
              chainId: fromChain.id,
              data: transactionRequest.data as Hex,
              to: transactionRequest.to as Address,
              value: transactionRequest.value,
            }

            calls.push(transferCall)

            txHash = (await sendCalls(this.client, {
              account: this.client.account!,
              calls,
            })) as Address
          } else {
            if (permitSupported) {
              const { data } = await signPermitMessage(
                this.client,
                transactionRequest,
                fromChain,
                step.action.fromToken.address as Address,
                BigInt(step.action.fromAmount),
                nativePermit,
                multicallSupported
              )

              multicallCalls.push({
                target: fromChain.permit2Proxy as Address,
                callData: data,
                allowFailure: true,
              })

              const multicallData = encodeFunctionData({
                abi: multicall3Abi,
                functionName: 'aggregate3',
                args: [multicallCalls],
              })

              // Update transaction request to call permit2 proxy
              transactionRequest.to = multicallAddress
              transactionRequest.data = multicallData

              // transactionRequest.to = fromChain.permit2Proxy
              // transactionRequest.data = data

              try {
                // Try to re-estimate the gas due to additional Permit data
                transactionRequest.gas = await estimateGas(this.client, {
                  account: this.client.account!,
                  to: transactionRequest.to as Address,
                  data: transactionRequest.data as Hex,
                  value: transactionRequest.value,
                })
              } catch {
                // Let the wallet estimate the gas in case of failure
                transactionRequest.gas = undefined
              }
            }

            txHash = await sendTransaction(this.client, {
              to: transactionRequest.to,
              account: this.client.account!,
              data: transactionRequest.data,
              value: transactionRequest.value,
              gas: transactionRequest.gas,
              gasPrice: transactionRequest.gasPrice,
              maxFeePerGas: transactionRequest.maxFeePerGas,
              maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
            } as SendTransactionParameters)
          }

          // STEP 4: Wait for the transaction
          process = this.statusManager.updateProcess(
            step,
            process.type,
            'PENDING',
            // When atomic batch is supported, txHash represents the batch hash rather than an individual transaction hash at this point
            atomicBatchSupported
              ? {
                  atomicBatchSupported,
                }
              : {
                  txHash: txHash,
                  txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
                }
          )
        }

        let transactionReceipt:
          | TransactionReceipt
          | WalletCallReceipt
          | undefined

        if (atomicBatchSupported) {
          transactionReceipt = await waitForBatchTransactionReceipt(
            this.client,
            txHash
          )
        } else {
          transactionReceipt = await waitForTransactionReceipt({
            client: this.client,
            chainId: fromChain.id,
            txHash,
            onReplaced: (response) => {
              this.statusManager.updateProcess(step, process.type, 'PENDING', {
                txHash: response.transaction.hash,
                txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
              })
            },
          })
        }

        // Update pending process if the transaction hash from the receipt is different.
        // This might happen if the transaction was replaced.
        if (
          transactionReceipt?.transactionHash &&
          transactionReceipt.transactionHash !== txHash
        ) {
          process = this.statusManager.updateProcess(
            step,
            process.type,
            'PENDING',
            {
              txHash: transactionReceipt.transactionHash,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transactionReceipt.transactionHash}`,
            }
          )
        }

        if (isBridgeExecution) {
          process = this.statusManager.updateProcess(step, process.type, 'DONE')
        }
      } catch (e: any) {
        const error = await parseEVMErrors(e, step, process)
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
      process = this.statusManager.findOrCreateProcess({
        step,
        type: 'RECEIVING_CHAIN',
        status: 'PENDING',
        chainId: toChain.id,
      })
    }

    try {
      if (!processTxHash) {
        throw new Error('Transaction hash is undefined.')
      }
      const statusResponse = (await waitForReceivingTransaction(
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
      throw await parseEVMErrors(e as Error, step, process)
    }

    // DONE
    return step
  }
}
