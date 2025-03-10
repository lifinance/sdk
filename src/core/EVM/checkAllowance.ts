import type { ExtendedChain, LiFiStep } from '@lifi/types'
import type { Address, Client, Hash } from 'viem'
import { MaxUint256 } from '../../constants.js'
import type { StatusManager } from '../StatusManager.js'
import type { ExecutionOptions, Process, ProcessType } from '../types.js'
import { getAllowance } from './getAllowance.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { getNativePermit } from './permits/getNativePermit.js'
import { signNativePermitMessage } from './permits/signNativePermitMessage.js'
import type {
  NativePermitData,
  NativePermitSignature,
} from './permits/types.js'
import { prettifyNativePermitData } from './permits/utils.js'
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
      data: NativePermitSignature
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

    const approved = await getAllowance(
      chain.id,
      step.action.fromToken.address as Address,
      client.account!.address,
      spenderAddress as Address
    )

    // Return early if already approved
    if (fromAmount <= approved) {
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      return { status: 'DONE' }
    }

    const isRelayerTransaction = isRelayerStep(step)

    let nativePermitData: NativePermitData | undefined
    if (isRelayerTransaction) {
      const permitData = step.permits.find(
        (p) => p.permitType === 'Permit'
      )?.permitData
      if (permitData) {
        nativePermitData = prettifyNativePermitData(permitData)
      }
    } else {
      nativePermitData = await getNativePermit(
        client,
        chain,
        step.action.fromToken.address as Address,
        fromAmount
      )
    }

    statusManager.updateProcess(step, allowanceProcess.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Check if proxy contract is available and token supports native permits, not available for atomic batch
    const nativePermitSupported =
      !!nativePermitData && !!chain.permit2Proxy && !batchingSupported

    if (nativePermitSupported && nativePermitData) {
      const nativePermitSignature = await signNativePermitMessage(
        client,
        nativePermitData
      )
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      return { status: 'NATIVE_PERMIT', data: nativePermitSignature }
    }

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
