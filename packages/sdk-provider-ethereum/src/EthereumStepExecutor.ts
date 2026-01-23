import {
  BaseStepExecutor,
  checkBalance,
  convertQuoteToRoute,
  type ExecutionActionType,
  type ExtendedChain,
  getContractCallsQuote,
  getRelayerQuote,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  patchContractCalls,
  relayTransaction,
  type SDKClient,
  type SignedTypedData,
  type StepExecutionType,
  type StepExecutorOptions,
  stepComparison,
  TransactionError,
  type TransactionMethodType,
  type TransactionParameters,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
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
import { checkAllowance } from './actions/checkAllowance.js'
import { getMaxPriorityFeePerGas } from './actions/getMaxPriorityFeePerGas.js'
import { isBatchingSupported } from './actions/isBatchingSupported.js'
import { switchChain } from './actions/switchChain.js'
import { waitForBatchTransactionReceipt } from './actions/waitForBatchTransactionReceipt.js'
import { waitForRelayedTransactionReceipt } from './actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from './actions/waitForTransactionReceipt.js'
import {
  isAtomicReadyWalletRejectedUpgradeError,
  parseEthereumErrors,
} from './errors/parseEthereumErrors.js'
import { PatcherMagicNumber } from './permits/constants.js'
import { encodeNativePermitData } from './permits/encodeNativePermitData.js'
import { encodePermit2Data } from './permits/encodePermit2Data.js'
import { isNativePermitValid } from './permits/isNativePermitValid.js'
import { signPermit2Message } from './permits/signPermit2Message.js'
import type { Call, WalletCallReceipt } from './types.js'
import { convertExtendedChain } from './utils/convertExtendedChain.js'
import { getActionWithFallback } from './utils/getActionWithFallback.js'
import { getDomainChainId } from './utils/getDomainChainId.js'
import { isContractCallStep } from './utils/isContractCallStep.js'
import { isGaslessStep } from './utils/isGaslessStep.js'
import { isRelayerStep } from './utils/isRelayerStep.js'
import { isZeroAddress } from './utils/isZeroAddress.js'

interface EthereumStepExecutorOptions extends StepExecutorOptions {
  client: Client
  switchChain?: (chainId: number) => Promise<Client | undefined>
}

export class EthereumStepExecutor extends BaseStepExecutor {
  private client: Client
  private switchChain?: (chainId: number) => Promise<Client | undefined>

  constructor(options: EthereumStepExecutorOptions) {
    super(options)
    this.client = options.client
    this.switchChain = options.switchChain
  }

  // Ensure that we are using the right chain and wallet when executing transactions.
  checkClient = async (
    step: LiFiStepExtended,
    type: StepExecutionType,
    targetChainId?: number
  ) => {
    const updatedClient = await switchChain(
      this.client,
      this.statusManager,
      step,
      type,
      targetChainId ?? step.action.fromChainId,
      this.allowUserInteraction,
      this.switchChain
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
      step = this.statusManager.updateExecution(step, {
        type,
        status: 'FAILED',
        error: {
          code: LiFiErrorCode.WalletChangedDuringExecution,
          message: errorMessage,
        },
      })
      throw await parseEthereumErrors(
        new TransactionError(
          LiFiErrorCode.WalletChangedDuringExecution,
          errorMessage
        ),
        step
      )
    }
    return updatedClient
  }

  waitForTransaction = async (
    client: SDKClient,
    {
      step,
      type,
      fromChain,
      toChain,
      isBridgeExecution,
    }: {
      step: LiFiStepExtended
      type: StepExecutionType
      fromChain: ExtendedChain
      toChain: ExtendedChain
      isBridgeExecution: boolean
    }
  ) => {
    const transaction = step.execution?.actions.find((t) => t.type === type)
    const updateProcessWithReceipt = (
      transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined,
      isBridgeExecution: boolean
    ) => {
      // Update pending process if the transaction hash from the receipt is different.
      // This might happen if the transaction was replaced or we used taskId instead of txHash.
      if (
        transactionReceipt?.transactionHash &&
        transactionReceipt.transactionHash !== transaction?.txHash
      ) {
        // Validate if transaction hash is a valid hex string that can be used on-chain
        // Some custom integrations may return non-hex identifiers to support custom status tracking
        const txHash = isHex(transactionReceipt.transactionHash, {
          strict: true,
        })
          ? transactionReceipt.transactionHash
          : undefined
        step = this.statusManager.updateExecution(step, {
          type,
          status: 'PENDING',
          action: {
            type: type as ExecutionActionType,
            chainId: fromChain.id,
            txHash: txHash,
            txLink:
              (transactionReceipt as WalletCallReceipt).transactionLink ||
              (txHash
                ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
                : undefined),
            isDone: isBridgeExecution,
          },
        })
      }
    }

    let transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
    switch (transaction?.txType) {
      case 'batched':
        transactionReceipt = await waitForBatchTransactionReceipt(
          this.client,
          transaction?.taskId as Hash,
          (result) => {
            const receipt = result.receipts?.find(
              (r) => r.status === 'reverted'
            ) as WalletCallReceipt | undefined
            if (receipt) {
              updateProcessWithReceipt(receipt, isBridgeExecution)
            }
          }
        )
        break
      case 'relayed':
        transactionReceipt = await waitForRelayedTransactionReceipt(
          client,
          transaction?.taskId as Hash,
          step
        )
        break
      default:
        transactionReceipt = await waitForTransactionReceipt(client, {
          client: this.client,
          chainId: fromChain.id,
          txHash: transaction?.txHash as Hash,
          onReplaced: (response) => {
            step = this.statusManager.updateExecution(step, {
              type,
              status: 'PENDING',
              action: {
                type: type as ExecutionActionType,
                chainId: fromChain.id,
                txHash: response.transaction.hash,
                txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
                isDone: isBridgeExecution,
              },
            })
          },
        })
    }

    updateProcessWithReceipt(transactionReceipt, isBridgeExecution)

    await waitForDestinationChainTransaction(
      client,
      step,
      type,
      fromChain,
      toChain,
      this.statusManager
    )
  }

  private prepareUpdatedStep = async (
    client: SDKClient,
    step: LiFiStepExtended,
    type: StepExecutionType,
    signedTypedData?: SignedTypedData[]
  ) => {
    const { execution, ...stepBase } = step
    const relayerStep = isRelayerStep(step)
    const gaslessStep = isGaslessStep(step)
    const contractCallStep = isContractCallStep(step)
    let updatedStep: LiFiStep
    if (contractCallStep) {
      const contractCallsResult =
        await this.executionOptions?.getContractCalls?.({
          fromAddress: stepBase.action.fromAddress!,
          fromAmount: BigInt(stepBase.action.fromAmount),
          fromChainId: stepBase.action.fromChainId,
          fromTokenAddress: stepBase.action.fromToken.address,
          slippage: stepBase.action.slippage,
          toAddress: stepBase.action.toAddress,
          toAmount: BigInt(stepBase.estimate.toAmount),
          toChainId: stepBase.action.toChainId,
          toTokenAddress: stepBase.action.toToken.address,
        })

      if (!contractCallsResult?.contractCalls?.length) {
        throw new TransactionError(
          LiFiErrorCode.TransactionUnprepared,
          'Unable to prepare transaction. Contract calls are not found.'
        )
      }

      if (contractCallsResult.patcher) {
        const patchedContractCalls = await patchContractCalls(
          client,
          contractCallsResult.contractCalls.map((call) => ({
            chainId: stepBase.action.toChainId,
            fromTokenAddress: call.fromTokenAddress,
            targetContractAddress: call.toContractAddress,
            callDataToPatch: call.toContractCallData,
            delegateCall: false,
            patches: [
              {
                amountToReplace: PatcherMagicNumber.toString(),
              },
            ],
          }))
        )

        contractCallsResult.contractCalls.forEach((call, index) => {
          call.toContractAddress = patchedContractCalls[index].target
          call.toContractCallData = patchedContractCalls[index].callData
        })
      }

      /**
       * Limitations of the retry logic for contract calls:
       * - denyBridges and denyExchanges are not supported
       * - allowBridges and allowExchanges are not supported
       * - fee is not supported
       * - toAmount is not supported
       */
      const contractCallQuote = await getContractCallsQuote(client, {
        // Contract calls are enabled only when fromAddress is set
        fromAddress: stepBase.action.fromAddress!,
        fromChain: stepBase.action.fromChainId,
        fromToken: stepBase.action.fromToken.address,
        fromAmount: stepBase.action.fromAmount,
        toChain: stepBase.action.toChainId,
        toToken: stepBase.action.toToken.address,
        contractCalls: contractCallsResult.contractCalls,
        toFallbackAddress: stepBase.action.toAddress,
        slippage: stepBase.action.slippage,
      })

      contractCallQuote.action.toToken = stepBase.action.toToken

      const customStep = contractCallQuote.includedSteps?.find(
        (step) => step.type === 'custom'
      )
      if (customStep && contractCallsResult?.contractTool) {
        const toolDetails = {
          key: contractCallsResult.contractTool.name,
          name: contractCallsResult.contractTool.name,
          logoURI: contractCallsResult.contractTool.logoURI,
        }
        customStep.toolDetails = toolDetails
        contractCallQuote.toolDetails = toolDetails
      }

      const route = convertQuoteToRoute(contractCallQuote, {
        adjustZeroOutputFromPreviousStep:
          this.executionOptions?.adjustZeroOutputFromPreviousStep,
      })

      updatedStep = {
        ...route.steps[0],
        id: stepBase.id,
      }
    } else if (relayerStep && gaslessStep) {
      const updatedRelayedStep = await getRelayerQuote(client, {
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
      const filteredSignedTypedData = signedTypedData?.filter(
        (item) => item.signature
      )
      const { typedData: _, ...restStepBase } = stepBase
      const params = filteredSignedTypedData?.length
        ? { ...restStepBase, typedData: filteredSignedTypedData }
        : restStepBase
      updatedStep = await getStepTransaction(client, params)
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
      // Only call checkClient for local accounts when we need to get maxPriorityFeePerGas
      let maxPriorityFeePerGas: bigint | undefined
      if (this.client.account?.type === 'local') {
        const updatedClient = await this.checkClient(step, type)
        if (!updatedClient) {
          return null
        }
        maxPriorityFeePerGas = await getMaxPriorityFeePerGas(
          client,
          updatedClient
        )
      } else {
        maxPriorityFeePerGas = step.transactionRequest.maxPriorityFeePerGas
          ? BigInt(step.transactionRequest.maxPriorityFeePerGas)
          : undefined
      }
      transactionRequest = {
        chainId: step.transactionRequest.chainId,
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
        maxPriorityFeePerGas,
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
    client: SDKClient,
    viemClient: Client,
    transactionRequest: TransactionParameters
  ) => {
    try {
      // Try to re-estimate the gas due to additional Permit data
      const estimatedGas = await getActionWithFallback(
        client,
        viemClient,
        estimateGas,
        'estimateGas',
        {
          account: viemClient.account!,
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
    client: SDKClient,
    step: LiFiStepExtended,
    // Explicitly set to true if the wallet rejected the upgrade to 7702 account, based on the EIP-5792 capabilities
    atomicityNotReady = false
  ): Promise<LiFiStepExtended> => {
    const isBridgeExecution = step.action.fromChainId !== step.action.toChainId
    const executionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    step = this.statusManager.initExecution(step, executionType)

    // Find if it's bridging and the step is waiting for a transaction on the destination chain
    const destinationChainTransaction = step.execution?.actions.find(
      (t) => t.type === 'RECEIVING_CHAIN'
    )

    // Make sure that the chain is still correct
    // If the step is waiting for a transaction on the destination chain, we do not switch the chain
    // All changes are already done from the source chain
    // Return the step
    if (
      destinationChainTransaction &&
      step.execution?.substatus !== 'WAIT_DESTINATION_TRANSACTION'
    ) {
      const updatedClient = await this.checkClient(step, executionType)
      if (!updatedClient) {
        return step
      }
    }

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

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
        : await isBatchingSupported(client, {
            client: this.client,
            chainId: fromChain.id,
          })

    // Find existing swap/bridge process
    const existingProcess = step?.execution?.actions.find(
      (p) => p.type === executionType
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
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval &&
      !step.estimate.skipPermit

    const checkForAllowance =
      // No existing swap/bridge transaction is pending
      !existingProcess?.txHash &&
      // No existing swap/bridge batch/order is pending
      !existingProcess?.taskId &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval

    if (checkForAllowance) {
      // Check if token needs approval and get approval transaction or message data when available
      const allowanceResult = await checkAllowance(client, {
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
          calls.push(...allowanceResult.data.calls)
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

    try {
      const transaction = step.execution?.actions.find(
        (t) => t.type === executionType
      )
      if (transaction?.isDone) {
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

      if (transaction?.txHash || transaction?.taskId) {
        // Make sure that the chain is still correct
        const updatedClient = await this.checkClient(step, executionType)
        if (!updatedClient) {
          return step
        }

        await this.waitForTransaction(client, {
          step,
          type: executionType,
          fromChain,
          toChain,
          isBridgeExecution,
        })

        return step
      }

      step = this.statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
      })

      await checkBalance(client, this.client.account!.address, step)

      // Try to prepare a new transaction request and update the step with typed data
      const preparedStep = await this.prepareUpdatedStep(
        client,
        step,
        executionType,
        signedTypedData
      )
      if (!preparedStep) {
        return step
      }

      let { transactionRequest, isRelayerTransaction } = preparedStep

      step = this.statusManager.updateExecution(step, {
        type: executionType,
        status: 'ACTION_REQUIRED',
      })

      if (!this.allowUserInteraction) {
        return step
      }

      let txHash: Hash | undefined
      let taskId: Hash | undefined
      let txType: TransactionMethodType = 'standard'
      let txLink: string | undefined

      if (batchingSupported && transactionRequest) {
        // Make sure that the chain is still correct
        const updatedClient = await this.checkClient(step, executionType)
        if (!updatedClient) {
          return step
        }
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
        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'MESSAGE_REQUIRED',
        })
        for (const typedData of intentTypedData) {
          if (!this.allowUserInteraction) {
            return step
          }
          const typedDataChainId =
            getDomainChainId(typedData.domain) || fromChain.id
          // Switch to the typed data's chain if needed
          const updatedClient = await this.checkClient(
            step,
            executionType,
            typedDataChainId
          )
          if (!updatedClient) {
            return step
          }
          const signature = await getAction(
            updatedClient,
            signTypedData,
            'signTypedData'
          )({
            account: updatedClient.account!,
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

        step = this.statusManager.updateExecution(step, {
          type: executionType,
          status: 'PENDING',
        })

        const { execution, ...stepBase } = step
        const relayedTransaction = await relayTransaction(client, {
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
        // Make sure that the chain is still correct
        const updatedClient = await this.checkClient(step, executionType)
        if (!updatedClient) {
          return step
        }
        const signedNativePermitTypedData = signedTypedData.find(
          (p) =>
            p.primaryType === 'Permit' &&
            getDomainChainId(p.domain) === fromChain.id
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
          step = this.statusManager.updateExecution(step, {
            type: executionType,
            status: 'MESSAGE_REQUIRED',
          })
          const permit2Signature = await signPermit2Message(client, {
            client: updatedClient,
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
          step = this.statusManager.updateExecution(step, {
            type: executionType,
            status: 'ACTION_REQUIRED',
          })
        }

        if (signedNativePermitTypedData || permit2Supported) {
          // Target address should be the Permit2 proxy contract in case of native permit or Permit2
          transactionRequest.to = fromChain.permit2Proxy as Address
          transactionRequest = await this.estimateTransactionRequest(
            client,
            updatedClient,
            transactionRequest
          )
        }

        txHash = await getAction(
          updatedClient,
          sendTransaction,
          'sendTransaction'
        )({
          to: transactionRequest.to as Address,
          account: updatedClient.account!,
          data: transactionRequest.data as Hex,
          value: transactionRequest.value,
          gas: transactionRequest.gas,
          gasPrice: transactionRequest.gasPrice,
          maxFeePerGas: transactionRequest.maxFeePerGas,
          maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
          chain: convertExtendedChain(fromChain),
        } as SendTransactionParameters)
      }

      // When atomic batch or relayer are supported, txHash represents the batch hash or taskId rather than an individual transaction hash
      step = this.statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
        signedAt: Date.now(),
        action: {
          type: executionType,
          chainId: fromChain.id,
          txHash,
          taskId,
          txType,
          txLink:
            txType === 'standard' && txHash
              ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
              : txLink,
          isDone: false,
        },
      })

      await this.waitForTransaction(client, {
        step,
        type: executionType,
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
        return this.executeStep(client, step, true)
      }
      const error = await parseEthereumErrors(e, step)
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
}
