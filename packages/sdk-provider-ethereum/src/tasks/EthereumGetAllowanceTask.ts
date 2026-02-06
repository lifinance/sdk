import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../actions/getAllowance.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { EthereumNativePermitTask } from './EthereumNativePermitTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumGetAllowanceTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_GET_ALLOWANCE'
  readonly actionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    const { step, fromChain } = context
    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)
    return (
      // No existing swap/bridge transaction is pending
      !context.isTransactionExecuted(action) &&
      // Token is not native (address is not zero)
      !isFromNativeToken &&
      // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      disableMessageSigning: boolean
    }
  ): Promise<TaskResult> {
    const { step, checkClient, fromChain, client, statusManager } = context

    const { signedTypedData, disableMessageSigning } = payload

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
    const isFromNativeToken =
      fromChain.nativeToken.address === step.action.fromToken.address &&
      isZeroAddress(step.action.fromToken.address)
    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const permit2Supported =
      !!fromChain.permit2 &&
      !!fromChain.permit2Proxy &&
      !batchingSupported &&
      !isFromNativeToken &&
      !disableMessageSigning &&
      // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval &&
      !step.estimate.skipPermit

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
      executionStrategy !== 'batch' &&
      !disableMessageSigning &&
      !step.estimate.skipPermit

    if (isNativePermitAvailable) {
      return await new EthereumNativePermitTask().execute(context, {
        signedTypedData,
        updatedClient,
        batchingSupported,
        approved,
        spenderAddress,
        permit2Supported,
      })
    }

    return await new EthereumResetAllowanceTask().execute(context, {
      signedTypedData,
      updatedClient,
      batchingSupported,
      approved,
      spenderAddress,
      permit2Supported,
    })
  }
}
