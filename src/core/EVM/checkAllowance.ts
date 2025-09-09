import type { ExtendedChain, LiFiStep, SignedTypedData } from '@lifi/types'
import type { Address, Client, Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { MaxUint256 } from '../../constants.js'
import type { StatusManager } from '../StatusManager.js'
import type {
  ExecutionOptions,
  LiFiStepExtended,
  Process,
  ProcessType,
} from '../types.js'
import { getActionWithFallback } from './getActionWithFallback.js'
import { getAllowance } from './getAllowance.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { getNativePermit } from './permits/getNativePermit.js'
import { isNativePermitValid } from './permits/isNativePermitValid.js'
import type { NativePermitData } from './permits/types.js'
import { setAllowance } from './setAllowance.js'
import type { Call } from './types.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export type CheckAllowanceParams = {
  checkClient(
    step: LiFiStepExtended,
    process: Process,
    targetChainId?: number
  ): Promise<Client | undefined>
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  batchingSupported?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
}

export type AllowanceResult =
  | {
      status: 'ACTION_REQUIRED'
    }
  | {
      status: 'BATCH_APPROVAL'
      data: { call: Call; signedTypedData: SignedTypedData[] }
    }
  | {
      status: 'NATIVE_PERMIT' | 'DONE'
      data: SignedTypedData[]
    }

export const checkAllowance = async ({
  checkClient,
  chain,
  step,
  statusManager,
  executionOptions,
  allowUserInteraction = false,
  batchingSupported = false,
  permit2Supported = false,
  disableMessageSigning = false,
}: CheckAllowanceParams): Promise<AllowanceResult> => {
  let sharedProcess: Process | undefined
  let signedTypedData: SignedTypedData[] = []
  try {
    // First, try to sign all permits in step.typedData
    const permitTypedData = step.typedData?.filter(
      (typedData) => typedData.primaryType === 'Permit'
    )
    if (!disableMessageSigning && permitTypedData?.length) {
      sharedProcess = statusManager.findOrCreateProcess({
        step,
        type: 'PERMIT',
        chainId: step.action.fromChainId,
      })
      signedTypedData = sharedProcess.signedTypedData ?? signedTypedData
      for (const typedData of permitTypedData) {
        const permitChainId = Number(typedData.domain.chainId)

        // Check if we already have a valid permit for this chain and requirements
        const signedTypedDataForChain = signedTypedData.find(
          (signedTypedData) =>
            Number(signedTypedData.domain.chainId) === permitChainId
        )
        const existingValidPermit =
          signedTypedDataForChain &&
          isNativePermitValid(signedTypedDataForChain, typedData)

        if (existingValidPermit) {
          // Skip signing if we already have a valid permit
          continue
        }

        sharedProcess = statusManager.updateProcess(
          step,
          sharedProcess.type,
          'ACTION_REQUIRED'
        )
        if (!allowUserInteraction) {
          return { status: 'ACTION_REQUIRED' }
        }

        // Switch to the permit's chain if needed
        const permitClient = await checkClient(
          step,
          sharedProcess,
          permitChainId
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
          primaryType: 'Permit',
          message: typedData.message,
        })
        const signedPermit: SignedTypedData = {
          ...typedData,
          signature,
        }
        signedTypedData.push(signedPermit)
        sharedProcess = statusManager.updateProcess(
          step,
          sharedProcess.type,
          'ACTION_REQUIRED',
          {
            signedTypedData,
          }
        )
      }

      statusManager.updateProcess(step, sharedProcess.type, 'DONE', {
        signedTypedData,
      })
      // Check if there's a signed permit for the source transaction chain
      const matchingPermit = signedTypedData.find(
        (signedTypedData) => Number(signedTypedData.domain.chainId) === chain.id
      )
      if (matchingPermit) {
        return {
          status: 'NATIVE_PERMIT',
          data: signedTypedData,
        }
      }
    }

    // Find existing or create new allowance process
    sharedProcess = statusManager.findOrCreateProcess({
      step,
      type: 'TOKEN_ALLOWANCE',
      chainId: step.action.fromChainId,
    })

    const updatedClient = await checkClient(step, sharedProcess)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Handle existing pending transaction
    if (sharedProcess.txHash && sharedProcess.status !== 'DONE') {
      await waitForApprovalTransaction(
        updatedClient,
        sharedProcess.txHash as Address,
        sharedProcess.type,
        step,
        chain,
        statusManager
      )
      return { status: 'DONE', data: signedTypedData }
    }

    // Start new allowance check
    statusManager.updateProcess(step, sharedProcess.type, 'STARTED')

    const spenderAddress = permit2Supported
      ? chain.permit2
      : step.estimate.approvalAddress

    const fromAmount = BigInt(step.action.fromAmount)

    const approved = await getAllowance(
      updatedClient,
      step.action.fromToken.address as Address,
      updatedClient.account!.address,
      spenderAddress as Address
    )

    // Return early if already approved
    if (fromAmount <= approved) {
      statusManager.updateProcess(step, sharedProcess.type, 'DONE')
      return { status: 'DONE', data: signedTypedData }
    }

    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!chain.permit2Proxy && !batchingSupported && !disableMessageSigning

    let nativePermitData: NativePermitData | undefined
    if (isNativePermitAvailable) {
      nativePermitData = await getActionWithFallback(
        updatedClient,
        getNativePermit,
        'getNativePermit',
        {
          chainId: chain.id,
          tokenAddress: step.action.fromToken.address as Address,
          spenderAddress: chain.permit2Proxy as Address,
          amount: fromAmount,
        }
      )
    }

    if (isNativePermitAvailable && nativePermitData) {
      signedTypedData = signedTypedData.length
        ? signedTypedData
        : sharedProcess.signedTypedData || []
      // Check if we already have a valid permit for this chain and requirements
      const signedTypedDataForChain = signedTypedData.find(
        (signedTypedData) =>
          Number(signedTypedData.domain.chainId) ===
          Number(nativePermitData.domain.chainId)
      )
      const existingValidPermit =
        signedTypedDataForChain &&
        isNativePermitValid(signedTypedDataForChain, nativePermitData)

      if (!existingValidPermit) {
        statusManager.updateProcess(step, sharedProcess.type, 'ACTION_REQUIRED')

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
          primaryType: 'Permit',
          message: nativePermitData.message,
        })

        // Add the new permit to the signed permits array
        const signedPermit: SignedTypedData = {
          ...nativePermitData,
          signature,
        }
        signedTypedData.push(signedPermit)
      }

      statusManager.updateProcess(step, sharedProcess.type, 'DONE', {
        signedTypedData,
      })
      return {
        status: 'NATIVE_PERMIT',
        data: signedTypedData,
      }
    }

    // Clear the txHash and txLink from potential previous approval transaction
    statusManager.updateProcess(step, sharedProcess.type, 'ACTION_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Set new allowance
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
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
      statusManager.updateProcess(step, sharedProcess.type, 'DONE')
      return {
        status: 'BATCH_APPROVAL',
        data: {
          call: {
            to: step.action.fromToken.address as Address,
            data: approveTxHash,
            chainId: step.action.fromToken.chainId,
          },
          signedTypedData,
        },
      }
    }

    await waitForApprovalTransaction(
      updatedClient,
      approveTxHash,
      sharedProcess.type,
      step,
      chain,
      statusManager
    )

    return { status: 'DONE', data: signedTypedData }
  } catch (e: any) {
    if (!sharedProcess) {
      sharedProcess = statusManager.findOrCreateProcess({
        step,
        type: 'TOKEN_ALLOWANCE',
        chainId: step.action.fromChainId,
      })
    }
    const error = await parseEVMErrors(e, step, sharedProcess)
    statusManager.updateProcess(step, sharedProcess.type, 'FAILED', {
      error: {
        message: error.cause.message,
        code: error.code,
      },
    })
    statusManager.updateExecution(step, 'FAILED')
    throw error
  }
}

const waitForApprovalTransaction = async (
  client: Client,
  txHash: Hash,
  processType: ProcessType,
  step: LiFiStep,
  chain: ExtendedChain,
  statusManager: StatusManager
) => {
  const baseExplorerUrl = chain.metamask.blockExplorerUrls[0]
  const getTxLink = (hash: Hash) => `${baseExplorerUrl}tx/${hash}`

  statusManager.updateProcess(step, processType, 'PENDING', {
    txHash,
    txLink: getTxLink(txHash),
  })

  const transactionReceipt = await waitForTransactionReceipt({
    client,
    chainId: chain.id,
    txHash,
    onReplaced(response) {
      const newHash = response.transaction.hash
      statusManager.updateProcess(step, processType, 'PENDING', {
        txHash: newHash,
        txLink: getTxLink(newHash),
      })
    },
  })

  const finalHash = transactionReceipt?.transactionHash || txHash
  statusManager.updateProcess(step, processType, 'DONE', {
    txHash: finalHash,
    txLink: getTxLink(finalHash),
  })
}
