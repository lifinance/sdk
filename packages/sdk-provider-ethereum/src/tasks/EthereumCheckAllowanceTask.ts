import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../actions/getAllowance.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
    }
  ): Promise<TaskResult> {
    const { step, checkClient, fromChain, client, statusManager } = context

    const { signedTypedData } = payload

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Start new allowance check
    statusManager.updateAction(step, action.type, 'STARTED')

    const executionStrategy = await context.getExecutionStrategy(step)
    const batchingSupported = executionStrategy === 'batch'
    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const permit2Supported = context.isPermit2Supported(batchingSupported)

    const spenderAddress = permit2Supported
      ? fromChain.permit2
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
      statusManager.updateAction(step, action.type, 'DONE')
      return {
        status: 'COMPLETED',
        data: {
          signedTypedData,
        },
      }
    }

    return {
      status: 'COMPLETED',
      data: {
        signedTypedData,
        updatedClient,
        batchingSupported,
        approved,
        spenderAddress,
      },
    }
  }
}
