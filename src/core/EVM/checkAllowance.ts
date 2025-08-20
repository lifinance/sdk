import type { ExtendedChain, LiFiStep, SignedTypedData } from '@lifi/types'
import type { Address, Client, Hash } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { MaxUint256 } from '../../constants.js'
import type { StatusManager } from '../StatusManager.js'
import type {
  ExecutionOptions,
  Process,
  ProcessType,
  SwitchChainHook,
} from '../types.js'
import { getActionWithFallback } from './getActionWithFallback.js'
// import { getAllowance } from './getAllowance.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { getNativePermit } from './permits/getNativePermit.js'
import type { NativePermitData } from './permits/types.js'
import { setAllowance } from './setAllowance.js'
import { isRelayerStep } from './typeguards.js'
import type { Call } from './types.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export type CheckAllowanceParams = {
  client: Client
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  batchingSupported?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
  switchChainHook: SwitchChainHook
}

export type AllowanceResult =
  | {
      status: 'ACTION_REQUIRED' | 'DONE'
    }
  | {
      status: 'BATCH_APPROVAL'
      data: Call
    }
  | {
      status: 'NATIVE_PERMIT'
      data: SignedTypedData
    }
  | {
      status: 'DESTINATION_NATIVE_PERMIT'
      data: SignedTypedData[]
    }

export const checkAllowance = async ({
  client,
  chain,
  step,
  statusManager,
  executionOptions,
  allowUserInteraction = false,
  batchingSupported = false,
  permit2Supported = false,
  disableMessageSigning = false,
  switchChainHook,
}: CheckAllowanceParams): Promise<AllowanceResult> => {
  // Find existing or create new allowance process
  const allowanceProcess: Process = statusManager.findOrCreateProcess({
    step,
    type: 'TOKEN_ALLOWANCE',
    chainId: step.action.fromChainId,
  })

  try {
    // Handle existing pending transaction
    if (allowanceProcess.txHash && allowanceProcess.status !== 'DONE') {
      await waitForApprovalTransaction(
        client,
        allowanceProcess.txHash as Address,
        allowanceProcess.type,
        step,
        chain,
        statusManager
      )
      return { status: 'DONE' }
    }

    // Start new allowance check
    statusManager.updateProcess(step, allowanceProcess.type, 'STARTED')

    const spenderAddress = permit2Supported
      ? chain.permit2
      : step.estimate.approvalAddress

    const fromAmount = BigInt(step.action.fromAmount)

    // const approved = await getAllowance(
    //   client,
    //   step.action.fromToken.address as Address,
    //   client.account!.address,
    //   spenderAddress as Address
    // )

    // // Return early if already approved
    // if (fromAmount <= approved) {
    //   statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
    //   return { status: 'DONE' }
    // }

    const isRelayerTransaction = isRelayerStep(step)

    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!chain.permit2Proxy && !batchingSupported && !disableMessageSigning

    let nativePermitData: NativePermitData | undefined
    let destinationChainNativePermitData: NativePermitData | undefined
    if (isRelayerTransaction) {
      const permitData = step.typedData?.find(
        (p) => p.primaryType === 'Permit'
      ) as NativePermitData
      if (permitData && permitData.domain.chainId === chain.id) {
        nativePermitData = permitData
      } else {
        destinationChainNativePermitData = permitData
      }
    } else if (isNativePermitAvailable) {
      nativePermitData = await getActionWithFallback(
        client,
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

    if (isRelayerTransaction && !nativePermitData) {
      nativePermitData = await getActionWithFallback(
        client,
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

    statusManager.updateProcess(step, allowanceProcess.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    const arr: any = []

    if (isNativePermitAvailable && nativePermitData) {
      const signature = await getAction(
        client,
        signTypedData,
        'signTypedData'
      )({
        account: client.account!,
        domain: nativePermitData.domain,
        types: nativePermitData.types,
        primaryType: 'Permit',
        message: nativePermitData.message,
      })
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      if (destinationChainNativePermitData) {
        arr.push({
          status: 'DESTINATION_NATIVE_PERMIT',
          data: {
            ...nativePermitData,
            signature,
          },
        })
      } else {
        return {
          status: 'NATIVE_PERMIT',
          data: {
            ...nativePermitData,
            signature,
          },
        }
      }
    }

    // if (destinationChainNativePermitData) {
    //   const updatedClient = await switchChainHook(
    //     destinationChainNativePermitData.domain.chainId as number
    //   )
    //   if (!updatedClient) {
    //     throw new Error('Client not updated')
    //   }
    //   const signature = await getAction(
    //     updatedClient,
    //     signTypedData,
    //     'signTypedData'
    //   )({
    //     account: client.account!,
    //     domain: destinationChainNativePermitData.domain,
    //     types: destinationChainNativePermitData.types,
    //     primaryType: 'Permit',
    //     message: destinationChainNativePermitData.message,
    //   })
    //   // statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
    //   await switchChainHook(chain.id)
    //   arr.push({
    //     status: 'DESTINATION_NATIVE_PERMIT',
    //     data: {
    //       ...destinationChainNativePermitData,
    //       signature,
    //     },
    //   })
    //   return { status: 'DESTINATION_NATIVE_PERMIT', data: arr }
    // }

    // Set new allowance
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      client,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      approveAmount,
      executionOptions,
      batchingSupported
    )

    if (destinationChainNativePermitData) {
      const updatedClient = await switchChainHook(
        destinationChainNativePermitData.domain.chainId as number
      )
      if (!updatedClient) {
        throw new Error('Client not updated')
      }
      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: client.account!,
        domain: destinationChainNativePermitData.domain,
        types: destinationChainNativePermitData.types,
        primaryType: 'Permit',
        message: destinationChainNativePermitData.message,
      })
      // statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      await switchChainHook(chain.id)
      arr.push({
        status: 'DESTINATION_NATIVE_PERMIT',
        data: {
          ...destinationChainNativePermitData,
          signature,
        },
      })
      return { status: 'DESTINATION_NATIVE_PERMIT', data: arr }
    }

    if (batchingSupported) {
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      return {
        status: 'BATCH_APPROVAL',
        data: {
          to: step.action.fromToken.address as Address,
          data: approveTxHash,
          chainId: step.action.fromToken.chainId,
        },
      }
    }

    await waitForApprovalTransaction(
      client,
      approveTxHash,
      allowanceProcess.type,
      step,
      chain,
      statusManager
    )

    return { status: 'DONE' }
  } catch (e: any) {
    const error = await parseEVMErrors(e, step, allowanceProcess)
    statusManager.updateProcess(step, allowanceProcess.type, 'FAILED', {
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
