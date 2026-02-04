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
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getAllowance } from '../../actions/getAllowance.js'
import { setAllowance } from '../../actions/setAllowance.js'
import { MaxUint256 } from '../../permits/constants.js'
import { getNativePermit } from '../../permits/getNativePermit.js'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import type { NativePermitData } from '../../permits/types.js'
import type { Call } from '../../types.js'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'
import { checkPermits } from './checkPermits.js'
import { waitForApprovalTransaction } from './waitForApprovalTransaction.js'
import { waitForResetApprovalAndUpdate } from './waitForResetApprovalAndUpdate.js'

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

export const checkAllowance = async (
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
  let signedTypedData: SignedTypedData[] = []
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

  // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
  const isNativePermitAvailable =
    !!chain.permit2Proxy && !disableMessageSigning && !step.estimate.skipPermit

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
    signedTypedData = signedTypedData.length
      ? signedTypedData
      : sharedAction.signedTypedData || []
    // Check if we already have a valid permit for this chain and requirements
    const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
      isNativePermitValid(signedTypedData, nativePermitData)
    )

    if (!signedTypedDataForChain) {
      statusManager.updateAction(step, sharedAction.type, 'ACTION_REQUIRED')

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

    statusManager.updateAction(step, sharedAction.type, 'DONE', {
      signedTypedData,
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
      false
    )

    // Wait for the reset transaction (non-batching path)
    const result = await waitForResetApprovalAndUpdate(
      client,
      updatedClient,
      approvalResetTxHash,
      sharedAction.type,
      step,
      chain,
      statusManager,
      allowUserInteraction
    )
    if (result) {
      return result
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
    false
  )

  await waitForApprovalTransaction(
    client,
    updatedClient,
    approveTxHash,
    sharedAction.type,
    step,
    chain,
    statusManager
  )

  return { status: 'DONE', data: signedTypedData }
}
