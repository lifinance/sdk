import type { ExtendedChain, LiFiStep, SignedTypedData } from '@lifi/types'
import type {
  Address,
  Client,
  GetAddressesReturnType,
  Hash,
  Hex,
  SendTransactionParameters,
  TransactionReceipt,
} from 'viem'
import {
  estimateGas,
  getAddresses,
  sendCalls,
  sendTransaction,
  signTypedData,
} from 'viem/actions'
import { getAction, isHex } from 'viem/utils'
import { config } from '../../config.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import {
  getRelayerQuote,
  getStepTransaction,
  relayTransaction,
} from '../../services/api.js'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import { BaseStepExecutor } from '../BaseStepExecutor.js'
import { checkBalance } from '../checkBalance.js'
import { stepComparison } from '../stepComparison.js'
import type {
  LiFiStepExtended,
  Process,
  StepExecutorOptions,
  TransactionMethodType,
  TransactionParameters,
} from '../types.js'
import { waitForDestinationChainTransaction } from '../waitForDestinationChainTransaction.js'
import { checkAllowance } from './checkAllowance.js'
import { getActionWithFallback } from './getActionWithFallback.js'
import { isBatchingSupported } from './isBatchingSupported.js'
import {
  isAtomicReadyWalletRejectedUpgradeError,
  parseEVMErrors,
} from './parseEVMErrors.js'
import { encodeNativePermitData } from './permits/encodeNativePermitData.js'
import { encodePermit2Data } from './permits/encodePermit2Data.js'
import { signPermit2Message } from './permits/signPermit2Message.js'
import { switchChain } from './switchChain.js'
import { isGaslessStep, isRelayerStep } from './typeguards.js'
import type { Call, WalletCallReceipt } from './types.js'
import { convertExtendedChain, getMaxPriorityFeePerGas } from './utils.js'
import { waitForBatchTransactionReceipt } from './waitForBatchTransactionReceipt.js'
import { waitForRelayedTransactionReceipt } from './waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

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

  waitForTransaction = async ({
    step,
    process,
    fromChain,
    toChain,
    isBridgeExecution,
  }: {
    step: LiFiStepExtended
    process: Process
    fromChain: ExtendedChain
    toChain: ExtendedChain
    isBridgeExecution: boolean
  }) => {
    let transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined

    switch (process.txType) {
      case 'batched':
        transactionReceipt = await waitForBatchTransactionReceipt(
          this.client,
          process.taskId as Hash
        )
        break
      case 'relayed':
        transactionReceipt = await waitForRelayedTransactionReceipt(
          process.taskId as Hash,
          step
        )
        break
      default:
        transactionReceipt = await waitForTransactionReceipt({
          client: this.client,
          chainId: fromChain.id,
          txHash: process.txHash as Hash,
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
      transactionReceipt.transactionHash !== process.txHash
    ) {
      // Validate if transaction hash is a valid hex string that can be used on-chain
      // Some custom integrations may return non-hex identifiers to support custom status tracking
      const txHash = isHex(transactionReceipt.transactionHash, { strict: true })
        ? transactionReceipt.transactionHash
        : undefined
      process = this.statusManager.updateProcess(
        step,
        process.type,
        'PENDING',
        {
          txHash: txHash,
          txLink:
            (transactionReceipt as WalletCallReceipt).transactionLink ||
            (txHash
              ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
              : undefined),
        }
      )
    }

    if (isBridgeExecution) {
      process = this.statusManager.updateProcess(step, process.type, 'DONE')
    }

    await waitForDestinationChainTransaction(
      step,
      process,
      fromChain,
      toChain,
      this.statusManager
    )
  }

  private getUpdatedStep = async (
    step: LiFiStepExtended,
    signedNativePermitTypedData?: SignedTypedData
  ): Promise<LiFiStep> => {
    // biome-ignore lint/correctness/noUnusedVariables: destructuring
    const { execution, ...stepBase } = step
    const relayerStep = isRelayerStep(step)
    const gaslessStep = isGaslessStep(step)
    if (relayerStep && gaslessStep) {
      const updatedRelayedStep = await getRelayerQuote({
        fromChain: stepBase.action.fromChainId,
        fromToken: stepBase.action.fromToken.address,
        fromAddress: stepBase.action.fromAddress!,
        fromAmount: stepBase.action.fromAmount,
        toChain: stepBase.action.toChainId,
        toToken: stepBase.action.toToken.address,
        slippage: stepBase.action.slippage,
        toAddress: stepBase.action.toAddress,
        allowBridges: [stepBase.tool],
      })
      return {
        ...updatedRelayedStep,
        id: stepBase.id,
      }
    }

    const params =
      relayerStep && !gaslessStep && signedNativePermitTypedData
        ? { ...stepBase, typedData: [signedNativePermitTypedData] }
        : stepBase

    return getStepTransaction(params)
  }

  executeStep = async (
    step: LiFiStepExtended,
    // Explicitly set to true if the wallet rejected the upgrade to 7702 account, based on the EIP-5792 capabilities
    atomicityNotReady = false
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    // Find if it's bridging and the step is waiting for a transaction on the destination chain
    const destinationChainProcess = step.execution?.process.find(
      (process) => process.type === 'RECEIVING_CHAIN'
    )

    // Make sure that the chain is still correct
    // If the step is waiting for a transaction on the destination chain, we do not switch the chain
    // All changes are already done from the source chain
    // Return the step
    if (destinationChainProcess?.substatus !== 'WAIT_DESTINATION_TRANSACTION') {
      const updatedClient = await this.checkClient(step)
      if (!updatedClient) {
        return step
      }
    }

    const fromChain = await config.getChainById(step.action.fromChainId)
    const toChain = await config.getChainById(step.action.toChainId)

    // Check if step requires permit signature and will be used with relayer service
    let isRelayerTransaction = isRelayerStep(step)

    // Check if the wallet supports atomic batch transactions (EIP-5792)
    const calls: Call[] = []

    // Batching via EIP-5792 is disabled in two cases:
    // 1. When atomicity is not ready or the wallet rejected the upgrade to 7702 account (atomicityNotReady is true)
    // 2. When the step is using thorswap tool
    const batchingSupported =
      atomicityNotReady || step.tool === 'thorswap'
        ? false
        : !isRelayerTransaction &&
          (await isBatchingSupported({
            client: this.client,
            chainId: fromChain.id,
          }))

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    // Find existing swap/bridge process
    const existingProcess = step.execution.process.find(
      (p) => p.type === currentProcessType
    )

    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)

    // Check if message signing is disabled - useful for smart contract wallets
    // We also disable message signing for custom steps
    const disableMessageSigning =
      this.executionOptions?.disableMessageSigning || step.type !== 'lifi'

    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const permit2Supported =
      !!fromChain.permit2 &&
      !!fromChain.permit2Proxy &&
      !batchingSupported &&
      !isFromNativeToken &&
      !disableMessageSigning &&
      // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
      !!step.estimate.approvalAddress

    const checkForAllowance =
      // No existing swap/bridge transaction is pending
      !existingProcess?.txHash &&
      // No existing swap/bridge batch/order is pending
      !existingProcess?.taskId &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress

    let signedNativePermitTypedData: SignedTypedData | undefined
    if (checkForAllowance) {
      // Check if token needs approval and get approval transaction or message data when available
      const allowanceResult = await checkAllowance({
        client: this.client,
        chain: fromChain,
        step,
        statusManager: this.statusManager,
        executionOptions: this.executionOptions,
        allowUserInteraction: this.allowUserInteraction,
        batchingSupported,
        permit2Supported,
        disableMessageSigning,
      })

      if (allowanceResult.status === 'BATCH_APPROVAL') {
        // Create approval transaction call
        // No value needed since we're only approving ERC20 tokens
        if (batchingSupported) {
          calls.push(allowanceResult.data)
        }
      }
      if (allowanceResult.status === 'NATIVE_PERMIT') {
        signedNativePermitTypedData = allowanceResult.data
      }
      if (
        allowanceResult.status === 'ACTION_REQUIRED' &&
        !this.allowUserInteraction
      ) {
        return step
      }
    }

    let process = this.statusManager.findProcess(step, currentProcessType)
    try {
      if (process?.status === 'DONE') {
        await waitForDestinationChainTransaction(
          step,
          process,
          fromChain,
          toChain,
          this.statusManager
        )

        return step
      }

      if (process?.txHash || process?.taskId) {
        // Make sure that the chain is still correct
        const updatedClient = await this.checkClient(step, process)
        if (!updatedClient) {
          return step
        }

        await this.waitForTransaction({
          step,
          process,
          fromChain,
          toChain,
          isBridgeExecution,
        })

        return step
      }

      const permitRequired =
        !batchingSupported && !signedNativePermitTypedData && permit2Supported
      process = this.statusManager.findOrCreateProcess({
        step,
        type: permitRequired ? 'PERMIT' : currentProcessType,
        status: 'STARTED',
        chainId: fromChain.id,
      })

      // Check balance
      await checkBalance(this.client.account!.address, step)

      // Create new transaction request
      if (
        !step.transactionRequest &&
        !step.typedData?.some((p) => p.primaryType !== 'Permit')
      ) {
        const updatedStep = await this.getUpdatedStep(
          step,
          signedNativePermitTypedData
        )
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
        isRelayerTransaction = isRelayerStep(comparedStep)
      }

      if (
        !step.transactionRequest &&
        !step.typedData?.some((p) => p.primaryType !== 'Permit')
      ) {
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          'Unable to prepare transaction.'
        )
      }

      let transactionRequest: TransactionParameters | undefined
      if (step.transactionRequest) {
        transactionRequest = {
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
      }

      if (
        this.executionOptions?.updateTransactionRequestHook &&
        transactionRequest
      ) {
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

      let txHash: Hash | undefined
      let taskId: Hash | undefined
      let txType: TransactionMethodType = 'standard'
      let txLink: string | undefined

      if (batchingSupported && transactionRequest) {
        const transferCall: Call = {
          chainId: fromChain.id,
          data: transactionRequest.data as Hex,
          to: transactionRequest.to as Address,
          value: transactionRequest.value,
        }

        calls.push(transferCall)

        const { id } = await getAction(
          this.client,
          sendCalls,
          'sendCalls'
        )({
          account: this.client.account!,
          calls,
        })
        taskId = id as Hash
        txType = 'batched'
      } else if (isRelayerTransaction) {
        const relayerTypedData = step.typedData?.find(
          (p) => p.primaryType !== 'Permit'
        )

        if (!relayerTypedData) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction. Typed data for transfer is not found.'
          )
        }

        const signature = await getAction(
          this.client,
          signTypedData,
          'signTypedData'
        )({
          account: this.client.account!,
          primaryType: relayerTypedData.primaryType,
          domain: relayerTypedData.domain,
          types: relayerTypedData.types,
          message: relayerTypedData.message,
        })

        this.statusManager.updateProcess(step, process.type, 'DONE')

        process = this.statusManager.findOrCreateProcess({
          step,
          type: currentProcessType,
          status: 'PENDING',
          chainId: fromChain.id,
        })

        const signedTypedData: SignedTypedData[] = [
          {
            ...relayerTypedData,
            signature: signature,
          },
        ]
        // Add native permit if available as first element, order is important
        if (signedNativePermitTypedData) {
          signedTypedData.unshift(signedNativePermitTypedData)
        }
        // biome-ignore lint/correctness/noUnusedVariables: destructuring
        const { execution, ...stepBase } = step
        const relayedTransaction = await relayTransaction({
          ...stepBase,
          typedData: signedTypedData,
        })
        taskId = relayedTransaction.taskId as Hash
        txType = 'relayed'
        txLink = relayedTransaction.txLink
      } else {
        if (!transactionRequest) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction. Transaction request is not found.'
          )
        }
        if (signedNativePermitTypedData) {
          transactionRequest.data = encodeNativePermitData(
            step.action.fromToken.address as Address,
            BigInt(step.action.fromAmount),
            signedNativePermitTypedData.message.deadline,
            signedNativePermitTypedData.signature,
            transactionRequest.data as Hex
          )
        } else if (permit2Supported) {
          const permit2Signature = await signPermit2Message({
            client: this.client,
            chain: fromChain,
            tokenAddress: step.action.fromToken.address as Address,
            amount: BigInt(step.action.fromAmount),
            data: transactionRequest.data as Hex,
          })
          this.statusManager.updateProcess(step, process.type, 'DONE')

          process = this.statusManager.findOrCreateProcess({
            step,
            type: currentProcessType,
            status: 'PENDING',
            chainId: fromChain.id,
          })
          transactionRequest.data = encodePermit2Data(
            step.action.fromToken.address as Address,
            BigInt(step.action.fromAmount),
            permit2Signature.message.nonce,
            permit2Signature.message.deadline,
            transactionRequest.data as Hex,
            permit2Signature.signature
          )
        }

        if (signedNativePermitTypedData || permit2Supported) {
          // Target address should be the Permit2 proxy contract in case of native permit or Permit2
          transactionRequest.to = fromChain.permit2Proxy
          try {
            // Try to re-estimate the gas due to additional Permit data
            const estimatedGas = await getActionWithFallback(
              this.client,
              estimateGas,
              'estimateGas',
              {
                account: this.client.account!,
                to: transactionRequest.to as Address,
                data: transactionRequest.data as Hex,
                value: transactionRequest.value,
              }
            )
            transactionRequest.gas =
              transactionRequest.gas && transactionRequest.gas > estimatedGas
                ? transactionRequest.gas
                : estimatedGas
          } catch (_) {
            // If we fail to estimate the gas, we add 80_000 gas units Permit buffer to the gas limit
            if (transactionRequest.gas) {
              transactionRequest.gas = transactionRequest.gas + 80_000n
            }
          } finally {
            this.statusManager.updateProcess(step, process.type, 'DONE')
          }
        }
        process = this.statusManager.updateProcess(
          step,
          process.type,
          'ACTION_REQUIRED'
        )
        txHash = await getAction(
          this.client,
          sendTransaction,
          'sendTransaction'
        )({
          to: transactionRequest.to as Address,
          account: this.client.account!,
          data: transactionRequest.data as Hex,
          value: transactionRequest.value,
          gas: transactionRequest.gas,
          gasPrice: transactionRequest.gasPrice,
          maxFeePerGas: transactionRequest.maxFeePerGas,
          maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
          chain: convertExtendedChain(fromChain),
        } as SendTransactionParameters)
      }

      process = this.statusManager.updateProcess(
        step,
        process.type,
        'PENDING',
        // When atomic batch or relayer are supported, txHash represents the batch hash or taskId rather than an individual transaction hash
        {
          txHash,
          taskId,
          txType,
          txLink:
            txType === 'standard' && txHash
              ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
              : txLink,
        }
      )

      await this.waitForTransaction({
        step,
        process,
        fromChain,
        toChain,
        isBridgeExecution,
      })

      // DONE
      return step
    } catch (e: any) {
      // If the wallet rejected the upgrade to 7702 account, we need to try again with the standard flow
      if (isAtomicReadyWalletRejectedUpgradeError(e) && !atomicityNotReady) {
        step.execution = undefined
        return this.executeStep(step, true)
      }
      const error = await parseEVMErrors(e, step, process)
      process = this.statusManager.updateProcess(
        step,
        process?.type || currentProcessType,
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
}
