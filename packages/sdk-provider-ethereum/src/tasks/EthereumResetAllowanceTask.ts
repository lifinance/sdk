import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Client, Hash } from 'viem'
import { setAllowance } from '../actions/setAllowance.js'
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumResetAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_RESET_ALLOWANCE'
  readonly actionType = 'TOKEN_ALLOWANCE'

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      updatedClient: Client
      batchingSupported: boolean
      approved: bigint
      spenderAddress: Address
    }
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      client,
      executionOptions,
      fromChain,
    } = context
    const {
      signedTypedData,
      updatedClient,
      batchingSupported,
      approved,
      spenderAddress,
    } = payload

    const shouldResetApproval = step.estimate.approvalReset && approved > 0n
    const resetApprovalStatus = shouldResetApproval
      ? 'RESET_REQUIRED'
      : 'ACTION_REQUIRED'

    // Clear the txHash and txLink from potential previous approval transaction
    statusManager.updateAction(step, action.type, resetApprovalStatus, {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
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
          action.type,
          step,
          fromChain,
          statusManager
        )

        statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
          txHash: undefined,
          txLink: undefined,
        })

        if (!allowUserInteraction) {
          return { status: 'PAUSED' }
        }
      }
    }

    return await new EthereumSetAllowanceTask().execute(context, {
      signedTypedData,
      updatedClient,
      spenderAddress,
      batchingSupported,
      shouldResetApproval,
      approvalResetTxHash,
    })
  }
}
