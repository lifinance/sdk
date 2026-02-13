import {
  type ExecutionAction,
  type SignedTypedData,
  TaskPipeline,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import { EthereumCheckAllowanceTask } from '../tasks/EthereumCheckAllowanceTask.js'
import { EthereumNativePermitTask } from '../tasks/EthereumNativePermitTask.js'
import { EthereumResetAllowanceTask } from '../tasks/EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from '../tasks/EthereumSetAllowanceTask.js'
import { EthereumWaitForApprovalTransactionTask } from '../tasks/EthereumWaitForApprovalTransaction.js'
import { shouldCheckForAllowance } from '../tasks/helpers/shouldCheckForAllowance.js'

export class EthereumTokenAllowancePipeline extends TaskPipeline {
  constructor() {
    super('TOKEN_ALLOWANCE', [
      new EthereumCheckAllowanceTask(),
      new EthereumNativePermitTask(),
      new EthereumResetAllowanceTask(),
      new EthereumSetAllowanceTask(),
      new EthereumWaitForApprovalTransactionTask(),
    ])
  }

  override async shouldRun(
    context: EthereumStepExecutorContext,
    _action?: ExecutionAction
  ): Promise<boolean> {
    const { statusManager, step, isFromNativeToken, isBridgeExecution } =
      context
    const permitAction = statusManager.findAction(step, 'PERMIT')
    // Check if there's a signed permit for the source transaction chain
    const matchingPermit = permitAction?.signedTypedData.find(
      (signedTypedData: SignedTypedData) =>
        getDomainChainId(signedTypedData.domain) === step.action.fromChainId
    )
    return (
      shouldCheckForAllowance(
        step,
        isBridgeExecution,
        isFromNativeToken,
        statusManager
      ) && !matchingPermit
    )
  }
}
