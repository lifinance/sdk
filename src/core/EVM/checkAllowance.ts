import type { ExtendedChain, LiFiStep } from '@lifi/types'
import type { Address, Client, Hash } from 'viem'
import { MaxUint256 } from '../../constants.js'
import type { StatusManager } from '../StatusManager.js'
import type { ExecutionOptions, Process, ProcessType } from '../types.js'
import { getAllowance } from './getAllowance.js'
import { parseEVMErrors } from './parseEVMErrors.js'
import { setAllowance } from './setAllowance.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export type CheckAllowanceParams = {
  client: Client
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  atomicBatchSupported?: boolean
  permit2Supported?: boolean
}

export const checkAllowance = async ({
  client,
  chain,
  step,
  statusManager,
  executionOptions,
  allowUserInteraction = false,
  atomicBatchSupported = false,
  permit2Supported = false,
}: CheckAllowanceParams): Promise<Hash | void> => {
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
      return
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
      return
    }

    if (!allowUserInteraction) {
      return
    }

    statusManager.updateProcess(step, allowanceProcess.type, 'ACTION_REQUIRED')

    // Set new allowance
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      client,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      approveAmount,
      executionOptions,
      atomicBatchSupported
    )

    if (atomicBatchSupported) {
      statusManager.updateProcess(step, allowanceProcess.type, 'DONE')
      return approveTxHash
    }

    await waitForApprovalTransaction(
      client,
      approveTxHash,
      allowanceProcess.type,
      step,
      chain,
      statusManager
    )
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
