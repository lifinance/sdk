import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../actions/getAllowance.js'
import { EthereumNativePermitTask } from './EthereumNativePermitTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_CHECK_ALLOWANCE'
  readonly actionType = 'TOKEN_ALLOWANCE'

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
    }
  ): Promise<TaskResult> {
    const {
      step,
      checkClient,
      fromChain,
      client,
      statusManager,
      disableMessageSigning,
    } = context

    const { signedTypedData } = payload

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Handle existing pending transaction
    if (action.txHash && action.status !== 'DONE') {
      await waitForApprovalTransaction(
        client,
        updatedClient,
        action.txHash as Address,
        action.type,
        step,
        fromChain,
        statusManager
      )
      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
      })
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
      return await new EthereumPrepareTransactionTask().execute(context, {
        signedTypedData,
      })
    }
    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!fromChain.permit2Proxy &&
      !batchingSupported &&
      !disableMessageSigning &&
      !step.estimate.skipPermit

    if (isNativePermitAvailable) {
      return await new EthereumNativePermitTask().execute(context, {
        signedTypedData,
        updatedClient,
        batchingSupported,
        approved,
        spenderAddress,
      })
    }

    return await new EthereumResetAllowanceTask().execute(context, {
      signedTypedData,
      updatedClient,
      batchingSupported,
      approved,
      spenderAddress,
    })
  }
}
