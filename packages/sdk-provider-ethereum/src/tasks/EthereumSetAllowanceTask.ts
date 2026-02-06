import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Client, Hash } from 'viem'
import { setAllowance } from '../actions/setAllowance.js'
import { MaxUint256 } from '../permits/constants.js'
import type { Call } from '../types.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumSetAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_SET_ALLOWANCE'
  readonly actionType = 'TOKEN_ALLOWANCE'

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      updatedClient: Client
      spenderAddress: Address
      batchingSupported: boolean
      permit2Supported: boolean
      shouldResetApproval: boolean
      approvalResetTxHash: Hash
    }
  ): Promise<TaskResult> {
    const { step, client, statusManager, executionOptions, fromChain } = context
    const {
      signedTypedData,
      updatedClient,
      spenderAddress,
      batchingSupported,
      permit2Supported,
      shouldResetApproval,
      approvalResetTxHash,
    } = payload

    // Set new allowance
    const fromAmount = BigInt(step.action.fromAmount)
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
      statusManager.updateAction(step, action.type, 'DONE')
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

      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
        calls,
      })
    }

    await waitForApprovalTransaction(
      client,
      updatedClient,
      approveTxHash,
      action.type,
      step,
      fromChain,
      statusManager
    )

    return await new EthereumPrepareTransactionTask().execute(context, {
      signedTypedData,
    })
  }
}
