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
import { isNativePermitValid } from './permits/isNativePermitValid.js'
import { signPermit2Message } from './permits/signPermit2Message.js'
import { switchChain } from './switchChain.js'
import { isGaslessStep, isRelayerStep } from './typeguards.js'
import type { Call, WalletCallReceipt } from './types.js'
import {
  convertExtendedChain,
  getMaxPriorityFeePerGas,
  isSaltMatchingChainId,
} from './utils.js'
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
  checkClient = async (
    step: LiFiStepExtended,
    process: Process,
    targetChainId?: number
  ) => {
    const updatedClient = await switchChain(
      this.client,
      this.statusManager,
      step,
      process,
      targetChainId ?? step.action.fromChainId,
      this.allowUserInteraction,
      this.executionOptions
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
      const errorMessage =
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      this.statusManager.updateProcess(step, process.type, 'FAILED', {
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
    const updateProcessWithReceipt = (
      transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
    ) => {
      // Update pending process if the transaction hash from the receipt is different.
      // This might happen if the transaction was replaced or we used taskId instead of txHash.
      if (
        transactionReceipt?.transactionHash &&
        transactionReceipt.transactionHash !== process.txHash
      ) {
        // Validate if transaction hash is a valid hex string that can be used on-chain
        // Some custom integrations may return non-hex identifiers to support custom status tracking
        const txHash = isHex(transactionReceipt.transactionHash, {
          strict: true,
        })
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
    }

    let transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
    switch (process.txType) {
      case 'batched':
        transactionReceipt = await waitForBatchTransactionReceipt(
          this.client,
          process.taskId as Hash,
          (result) => {
            const receipt = result.receipts?.find(
              (r) => r.status === 'reverted'
            ) as WalletCallReceipt | undefined
            if (receipt) {
              updateProcessWithReceipt(receipt)
            }
          }
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

    updateProcessWithReceipt(transactionReceipt)

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

  private prepareUpdatedStep = async (
    step: LiFiStepExtended,
    signedTypedData?: SignedTypedData[]
  ) => {
    // biome-ignore lint/correctness/noUnusedVariables: destructuring
    const { execution, ...stepBase } = step
    const relayerStep = isRelayerStep(step)
    const gaslessStep = isGaslessStep(step)
    let updatedStep: LiFiStep
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
      updatedStep = {
        ...updatedRelayedStep,
        id: stepBase.id,
      }
    } else {
      const params = signedTypedData?.length
        ? { ...stepBase, typedData: signedTypedData }
        : stepBase
      updatedStep = await getStepTransaction(params)
    }

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
      typedData: updatedStep.typedData ?? step.typedData,
    })

    if (!step.transactionRequest && !step.typedData?.length) {
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

    return {
      transactionRequest,
      // We should always check against the updated step,
      // because the step may be updated with typed data from the previously signed typed data
      isRelayerTransaction: isRelayerStep(updatedStep),
    }
  }

  private estimateTransactionRequest = async (
    transactionRequest: TransactionParameters,
    fromChain: ExtendedChain
  ) => {
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
    }

    return transactionRequest
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
    if (
      destinationChainProcess &&
      destinationChainProcess.substatus !== 'WAIT_DESTINATION_TRANSACTION'
    ) {
      const updatedClient = await this.checkClient(
        step,
        destinationChainProcess
      )
      if (!updatedClient) {
        return step
      }
    }

    const fromChain = await config.getChainById(step.action.fromChainId)
    const toChain = await config.getChainById(step.action.toChainId)

    // Check if the wallet supports atomic batch transactions (EIP-5792)
    const calls: Call[] = []
    // Signed typed data for native permits and other messages
    let signedTypedData: SignedTypedData[] = []

    // Batching via EIP-5792 is disabled in the next cases:
    // 1. When atomicity is not ready or the wallet rejected the upgrade to 7702 account (atomicityNotReady is true)
    // 2. When the step is using thorswap tool (temporary disabled)
    // 3. When using relayer transactions
    const batchingSupported =
      atomicityNotReady || step.tool === 'thorswap' || isRelayerStep(step)
        ? false
        : await isBatchingSupported({
            client: this.client,
            chainId: fromChain.id,
          })

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

    if (checkForAllowance) {
      // Check if token needs approval and get approval transaction or message data when available
      const allowanceResult = await checkAllowance({
        checkClient: this.checkClient,
        chain: fromChain,
        step,
        statusManager: this.statusManager,
        executionOptions: this.executionOptions,
        allowUserInteraction: this.allowUserInteraction,
        batchingSupported,
        permit2Supported,
        disableMessageSigning,
      })

      switch (allowanceResult.status) {
        case 'BATCH_APPROVAL':
          calls.push(allowanceResult.data.call)
          signedTypedData = allowanceResult.data.signedTypedData
          break
        case 'NATIVE_PERMIT':
          signedTypedData = allowanceResult.data
          break
        case 'DONE':
          signedTypedData = allowanceResult.data
          break
        default:
          if (!this.allowUserInteraction) {
            return step
          }
          break
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

      process = this.statusManager.findOrCreateProcess({
        step,
        type: currentProcessType,
        status: 'STARTED',
        chainId: fromChain.id,
      })

      await checkBalance(this.client.account!.address, step)

      // Try to prepare a new transaction request and update the step with typed data
      let { transactionRequest, isRelayerTransaction } =
        await this.prepareUpdatedStep(step, signedTypedData)

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
        const intentTypedData = step.typedData?.filter(
          (typedData) =>
            !signedTypedData.some((signedPermit) =>
              isNativePermitValid(signedPermit, typedData)
            )
        )
        if (!intentTypedData?.length) {
          throw new TransactionError(
            LiFiErrorCode.TransactionUnprepared,
            'Unable to prepare transaction. Typed data for transfer is not found.'
          )
        }
        this.statusManager.updateProcess(step, process.type, 'MESSAGE_REQUIRED')
        for (const typedData of intentTypedData) {
          const signature = await getAction(
            this.client,
            signTypedData,
            'signTypedData'
          )({
            account: this.client.account!,
            primaryType: typedData.primaryType,
            domain: typedData.domain,
            types: typedData.types,
            message: typedData.message,
          })
          signedTypedData.push({
            ...typedData,
            signature: signature,
          })
        }

        this.statusManager.updateProcess(step, process.type, 'PENDING')

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
        const signedNativePermitTypedData = signedTypedData.find(
          (p) =>
            p.primaryType === 'Permit' &&
            (p.domain.chainId === fromChain.id ||
              isSaltMatchingChainId(p.domain.salt as Hex, fromChain.id))
        )
        if (signedNativePermitTypedData) {
          transactionRequest.data = encodeNativePermitData(
            step.action.fromToken.address as Address,
            BigInt(step.action.fromAmount),
            signedNativePermitTypedData.message.deadline,
            signedNativePermitTypedData.signature,
            transactionRequest.data as Hex
          )
        } else if (permit2Supported) {
          this.statusManager.updateProcess(
            step,
            process.type,
            'MESSAGE_REQUIRED'
          )
          const permit2Signature = await signPermit2Message({
            client: this.client,
            chain: fromChain,
            tokenAddress: step.action.fromToken.address as Address,
            amount: BigInt(step.action.fromAmount),
            data: transactionRequest.data as Hex,
          })
          transactionRequest.data = encodePermit2Data(
            step.action.fromToken.address as Address,
            BigInt(step.action.fromAmount),
            permit2Signature.message.nonce,
            permit2Signature.message.deadline,
            transactionRequest.data as Hex,
            permit2Signature.signature
          )
          this.statusManager.updateProcess(
            step,
            process.type,
            'ACTION_REQUIRED'
          )
        }

        if (signedNativePermitTypedData || permit2Supported) {
          transactionRequest = await this.estimateTransactionRequest(
            transactionRequest,
            fromChain
          )
        }

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
