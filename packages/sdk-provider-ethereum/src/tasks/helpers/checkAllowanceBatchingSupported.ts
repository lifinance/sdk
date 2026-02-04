import type {
  ExecutionAction,
  ExecutionOptions,
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  SDKClient,
  SignedTypedData,
  StatusManager,
} from '@lifi/sdk'
import type { Address, Client, Hash } from 'viem'
import { getAllowance } from '../../actions/getAllowance.js'
import { setAllowance } from '../../actions/setAllowance.js'
import { MaxUint256 } from '../../permits/constants.js'
import type { Call } from '../../types.js'
import { waitForApprovalTransaction } from '../helpers/waitForApprovalTransaction.js'
import { buildBatchApprovalResult } from './buildBatchApprovalResult.js'
import { checkPermits } from './checkPermits.js'

type CheckAllowanceParams = {
  checkClient(
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ): Promise<Client | undefined>
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
}

export type AllowanceResult =
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

export const checkAllowanceBatchingSupported = async (
  client: SDKClient,
  {
    checkClient,
    chain,
    step,
    statusManager,
    executionOptions,
    allowUserInteraction = false,
    permit2Supported = false,
    disableMessageSigning = false,
  }: CheckAllowanceParams
): Promise<AllowanceResult> => {
  let sharedAction: ExecutionAction | undefined
  const signedTypedData: SignedTypedData[] = []
  // First, try to sign all permits in step.typedData
  const permitTypedData = step.typedData?.filter(
    (typedData) => typedData.primaryType === 'Permit'
  )
  const runCheckPermits = !disableMessageSigning && permitTypedData?.length

  if (runCheckPermits) {
    const permitsResult = await checkPermits(
      step,
      statusManager,
      permitTypedData,
      allowUserInteraction,
      checkClient
    )
    if (permitsResult) {
      return permitsResult
    }
  }

  // Find existing or create new allowance action
  sharedAction = statusManager.findOrCreateAction({
    step,
    type: 'TOKEN_ALLOWANCE',
    chainId: step.action.fromChainId,
  })

  const updatedClient = await checkClient(step, sharedAction)
  if (!updatedClient) {
    return { status: 'ACTION_REQUIRED' }
  }

  // Handle existing pending transaction
  if (sharedAction.txHash && sharedAction.status !== 'DONE') {
    await waitForApprovalTransaction(
      client,
      updatedClient,
      sharedAction.txHash as Address,
      sharedAction.type,
      step,
      chain,
      statusManager
    )
    return { status: 'DONE', data: signedTypedData }
  }

  // Start new allowance check
  statusManager.updateAction(step, sharedAction.type, 'STARTED')

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
    statusManager.updateAction(step, sharedAction.type, 'DONE')
    return { status: 'DONE', data: signedTypedData }
  }

  const shouldResetApproval = step.estimate.approvalReset && approved > 0n
  const resetApprovalStatus = shouldResetApproval
    ? 'RESET_REQUIRED'
    : 'ACTION_REQUIRED'

  // Clear the txHash and txLink from potential previous approval transaction
  statusManager.updateAction(step, sharedAction.type, resetApprovalStatus, {
    txHash: undefined,
    txLink: undefined,
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
      true
    )
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
    true
  )

  // Return the batch approval data because allowance wasn't set by standard
  // approval transaction (this flow is for batching-supported execution)
  return buildBatchApprovalResult(
    step,
    sharedAction,
    statusManager,
    shouldResetApproval,
    approvalResetTxHash,
    approveTxHash,
    signedTypedData
  )
}
