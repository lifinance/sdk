import type {
  ExecutionActionType,
  ExtendedChain,
  LiFiStep,
  SDKClient,
  StatusManager,
} from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { waitForApprovalTransaction } from './waitForApprovalTransaction.js'

export type ActionRequiredResult = { status: 'ACTION_REQUIRED' }

/**
 * Waits for the reset approval transaction, updates the action state, and
 * returns ACTION_REQUIRED if user interaction is not allowed.
 */
export async function waitForResetApprovalAndUpdate(
  client: SDKClient,
  updatedClient: Client,
  approvalResetTxHash: Hash,
  actionType: ExecutionActionType,
  step: LiFiStep,
  chain: ExtendedChain,
  statusManager: StatusManager,
  allowUserInteraction: boolean
): Promise<ActionRequiredResult | undefined> {
  await waitForApprovalTransaction(
    client,
    updatedClient,
    approvalResetTxHash,
    actionType,
    step,
    chain,
    statusManager
  )

  statusManager.updateAction(step, actionType, 'ACTION_REQUIRED', {
    txHash: undefined,
    txLink: undefined,
  })

  if (!allowUserInteraction) {
    return { status: 'ACTION_REQUIRED' }
  }
  return undefined
}
