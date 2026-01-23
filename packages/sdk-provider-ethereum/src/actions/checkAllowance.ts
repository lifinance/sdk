import type {
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  SDKClient,
  SignedTypedData,
  StatusManager,
  StepExecutionType,
} from '@lifi/sdk'
import type { Address, Client, Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from '../errors/parseEthereumErrors.js'
import { MaxUint256 } from '../permits/constants.js'
import { getNativePermit } from '../permits/getNativePermit.js'
import { isNativePermitValid } from '../permits/isNativePermitValid.js'
import type { NativePermitData } from '../permits/types.js'
import type { Call } from '../types.js'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import { getDomainChainId } from '../utils/getDomainChainId.js'
import { getAllowance } from './getAllowance.js'
import { setAllowance } from './setAllowance.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

type CheckAllowanceParams = {
  checkClient(
    step: LiFiStepExtended,
    type: StepExecutionType,
    targetChainId?: number
  ): Promise<Client | undefined>
  chain: ExtendedChain
  step: LiFiStepExtended
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  batchingSupported?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
}

type AllowanceResult =
  | {
      status: 'ACTION_REQUIRED'
    }
  | {
      status: 'BATCH_APPROVAL'
      data: { calls: Call[]; signedTypedData: SignedTypedData[] }
    }
  | {
      status: 'NATIVE_PERMIT' | 'DONE'
      data: SignedTypedData[]
    }

export const checkAllowance = async (
  client: SDKClient,
  {
    checkClient,
    chain,
    step,
    statusManager,
    executionOptions,
    allowUserInteraction = false,
    batchingSupported = false,
    permit2Supported = false,
    disableMessageSigning = false,
  }: CheckAllowanceParams
): Promise<AllowanceResult> => {
  let executionType: StepExecutionType = 'PERMIT'
  let signedTypedData: SignedTypedData[] = []
  try {
    // First, try to sign all permits in step.typedData
    const permitTypedData = step.typedData?.filter(
      (typedData) => typedData.primaryType === 'Permit'
    )
    if (!disableMessageSigning && permitTypedData?.length) {
      step = statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
      })
      const permitAction = step.execution?.actions.find(
        (a) => a.type === 'TOKEN_ALLOWANCE'
      )
      signedTypedData = permitAction?.signedTypedData ?? signedTypedData
      for (const typedData of permitTypedData) {
        // Check if we already have a valid permit for this chain and requirements
        const signedTypedDataForChain = signedTypedData.find(
          (signedTypedData) => isNativePermitValid(signedTypedData, typedData)
        )

        if (signedTypedDataForChain) {
          // Skip signing if we already have a valid permit
          continue
        }

        step = statusManager.updateExecution(step, {
          type: executionType,
          status: 'ACTION_REQUIRED',
        })
        if (!allowUserInteraction) {
          return { status: 'ACTION_REQUIRED' }
        }

        const typedDataChainId =
          getDomainChainId(typedData.domain) || step.action.fromChainId
        // Switch to the permit's chain if needed
        const permitClient = await checkClient(
          step,
          executionType,
          typedDataChainId
        )
        if (!permitClient) {
          return { status: 'ACTION_REQUIRED' }
        }

        const signature = await getAction(
          permitClient,
          signTypedData,
          'signTypedData'
        )({
          account: permitClient.account!,
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        })
        const signedPermit: SignedTypedData = {
          ...typedData,
          signature,
        }
        signedTypedData.push(signedPermit)
        step = statusManager.updateExecution(step, {
          type: executionType,
          status: 'ACTION_REQUIRED',
          action: {
            type: 'TOKEN_ALLOWANCE',
            signedTypedData,
          },
        })
      }

      step = statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
        action: {
          type: 'TOKEN_ALLOWANCE',
          signedTypedData,
        },
      })
      // Check if there's a signed permit for the source transaction chain
      const matchingPermit = signedTypedData.find(
        (signedTypedData) =>
          getDomainChainId(signedTypedData.domain) === step.action.fromChainId
      )
      if (matchingPermit) {
        return {
          status: 'NATIVE_PERMIT',
          data: signedTypedData,
        }
      }
    }

    // Find existing or create new allowance process
    executionType = 'TOKEN_ALLOWANCE'
    step = statusManager.updateExecution(step, {
      type: executionType,
      status: 'PENDING',
    })

    const updatedClient = await checkClient(step, executionType)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    const transaction = step.execution?.actions.find(
      (t) => t.type === executionType
    )
    // Handle existing pending transaction
    if (transaction?.txHash && !transaction?.isDone) {
      await waitForApprovalTransaction(
        client,
        updatedClient,
        transaction.txHash as Address,
        transaction.type,
        step,
        chain,
        statusManager
      )
      return { status: 'DONE', data: signedTypedData }
    }

    // Start new allowance check
    step = statusManager.updateExecution(step, {
      type: executionType,
      status: 'PENDING',
    })

    const spenderAddress = permit2Supported
      ? chain.permit2
      : step.estimate.approvalAddress

    const fromAmount = BigInt(step.action.fromAmount)

    const approved = await getAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      updatedClient.account!.address,
      spenderAddress as Address
    )

    // Return early if already approved
    if (fromAmount <= approved) {
      step = statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
      })
      return { status: 'DONE', data: signedTypedData }
    }

    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!chain.permit2Proxy &&
      !batchingSupported &&
      !disableMessageSigning &&
      !step.estimate.skipPermit

    let nativePermitData: NativePermitData | undefined
    if (isNativePermitAvailable) {
      nativePermitData = await getActionWithFallback(
        client,
        updatedClient,
        getNativePermit,
        'getNativePermit',
        {
          client,
          viemClient: updatedClient,
          chainId: chain.id,
          tokenAddress: step.action.fromToken.address as Address,
          spenderAddress: chain.permit2Proxy as Address,
          amount: fromAmount,
        }
      )
    }

    if (isNativePermitAvailable && nativePermitData) {
      const existingPermitAction = step.execution?.actions.find(
        (a) => a.type === 'TOKEN_ALLOWANCE'
      )
      signedTypedData = signedTypedData.length
        ? signedTypedData
        : existingPermitAction?.signedTypedData || []
      // Check if we already have a valid permit for this chain and requirements
      const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
        isNativePermitValid(signedTypedData, nativePermitData)
      )

      if (!signedTypedDataForChain) {
        step = statusManager.updateExecution(step, {
          type: executionType,
          status: 'ACTION_REQUIRED',
        })

        if (!allowUserInteraction) {
          return { status: 'ACTION_REQUIRED' }
        }

        // Sign the permit
        const signature = await getAction(
          updatedClient,
          signTypedData,
          'signTypedData'
        )({
          account: updatedClient.account!,
          domain: nativePermitData.domain,
          types: nativePermitData.types,
          primaryType: nativePermitData.primaryType,
          message: nativePermitData.message,
        })

        // Add the new permit to the signed permits array
        const signedPermit: SignedTypedData = {
          ...nativePermitData,
          signature,
        }
        signedTypedData.push(signedPermit)
      }

      step = statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
        action: {
          type: 'TOKEN_ALLOWANCE',
          signedTypedData,
        },
      })
      return {
        status: 'NATIVE_PERMIT',
        data: signedTypedData,
      }
    }

    const shouldResetApproval = step.estimate.approvalReset && approved > 0n
    const resetApprovalStatus = shouldResetApproval
      ? 'RESET_REQUIRED'
      : 'ACTION_REQUIRED'

    // Clear the transaction from potential previous approval transaction
    step = statusManager.updateExecution(step, {
      type: executionType,
      status: resetApprovalStatus,
      actions: step.execution!.actions.filter((t) => t.type !== executionType),
    })

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Reset allowance to 0 if required
    let approvalResetTxHash: Hash | undefined
    if (shouldResetApproval) {
      approvalResetTxHash = await setAllowance(
        client,
        updatedClient,
        step.action.fromToken.address as Address,
        spenderAddress as Address,
        0n,
        executionOptions,
        batchingSupported
      )

      // If batching is NOT supported, wait for the reset transaction
      if (!batchingSupported) {
        await waitForApprovalTransaction(
          client,
          updatedClient,
          approvalResetTxHash,
          executionType,
          step,
          chain,
          statusManager
        )

        step = statusManager.updateExecution(step, {
          type: executionType,
          status: 'ACTION_REQUIRED',
          actions: step.execution!.actions.filter(
            (t) => t.type !== executionType
          ),
        })

        if (!allowUserInteraction) {
          return { status: 'ACTION_REQUIRED' }
        }
      }
    }

    // Set new allowance
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      approveAmount,
      executionOptions,
      // We need to return the populated transaction is batching is supported
      // instead of executing transaction on-chain
      batchingSupported
    )

    // If batching is supported, we need to return the batch approval data
    // because allowance was't set by standard approval transaction
    if (batchingSupported) {
      step = statusManager.updateExecution(step, {
        type: executionType,
        status: 'PENDING',
      })
      const calls: Call[] = []

      // Add reset call first if approval reset is required
      if (shouldResetApproval && approvalResetTxHash) {
        calls.push({
          to: step.action.fromToken.address as Address,
          data: approvalResetTxHash,
          chainId: step.action.fromToken.chainId,
        })
      }

      // Add approval call
      calls.push({
        to: step.action.fromToken.address as Address,
        data: approveTxHash,
        chainId: step.action.fromToken.chainId,
      })

      return {
        status: 'BATCH_APPROVAL',
        data: {
          calls,
          signedTypedData,
        },
      }
    }

    await waitForApprovalTransaction(
      client,
      updatedClient,
      approveTxHash,
      executionType,
      step,
      chain,
      statusManager
    )

    return { status: 'DONE', data: signedTypedData }
  } catch (e: any) {
    const error = await parseEthereumErrors(e, step, executionType)
    step = statusManager.updateExecution(step, {
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

const waitForApprovalTransaction = async (
  client: SDKClient,
  viemClient: Client,
  txHash: Hash,
  type: StepExecutionType,
  step: LiFiStep,
  chain: ExtendedChain,
  statusManager: StatusManager,
  approvalReset: boolean = false
) => {
  const baseExplorerUrl = chain.metamask.blockExplorerUrls[0]
  const getTxLink = (hash: Hash) => `${baseExplorerUrl}tx/${hash}`

  step = statusManager.updateExecution(step, {
    type,
    status: 'PENDING',
    action: {
      type: type as ExecutionActionType,
      chainId: chain.id,
      txHash,
      txLink: getTxLink(txHash),
      isDone: false,
    },
  })

  const transactionReceipt = await waitForTransactionReceipt(client, {
    client: viemClient,
    chainId: chain.id,
    txHash,
    onReplaced(response) {
      const newHash = response.transaction.hash
      step = statusManager.updateExecution(step, {
        type,
        status: 'PENDING',
        action: {
          type: type as ExecutionActionType,
          chainId: chain.id,
          txHash: newHash,
          txLink: getTxLink(newHash),
          isDone: false,
        },
      })
    },
  })

  const finalHash = transactionReceipt?.transactionHash || txHash
  if (!approvalReset) {
    step = statusManager.updateExecution(step, {
      type,
      status: 'PENDING',
      action: {
        type: type as ExecutionActionType,
        chainId: chain.id,
        txHash: finalHash,
        txLink: getTxLink(finalHash),
        isDone: true,
      },
    })
  }
}
