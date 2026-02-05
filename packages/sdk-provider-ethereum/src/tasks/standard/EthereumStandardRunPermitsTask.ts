import {
  BaseStepExecutionTask,
  type ExecutionActionType,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hex } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumStandardRunPermitsTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_STANDARD_RUN_PERMITS'
  readonly actionType: ExecutionActionType = 'PERMIT'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'standard' &&
      shouldRunAllowanceCheck(context) &&
      !context.allowanceFlow?.result
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    context.calls = context.calls ?? []
    context.signedTypedData = context.signedTypedData ?? []
    context.allowanceFlow = context.allowanceFlow ?? { signedTypedData: [] }

    const params = getAllowanceParams(context)
    const permitTypedData = context.step.typedData?.filter(
      (typedData) => typedData.primaryType === 'Permit'
    )
    let result:
      | { status: 'ACTION_REQUIRED' }
      | { status: 'NATIVE_PERMIT'; data: SignedTypedData[] }
      | null = null
    if (!params.disableMessageSigning && permitTypedData?.length) {
      let permitAction = context.statusManager.findOrCreateAction({
        step: context.step,
        type: 'PERMIT',
        chainId: context.step.action.fromChainId,
      })
      const signedTypedData: SignedTypedData[] =
        permitAction.signedTypedData ?? []
      for (const typedData of permitTypedData) {
        const signedTypedDataForChain = signedTypedData.find((s) =>
          isNativePermitValid(s, typedData)
        )
        if (signedTypedDataForChain) {
          continue
        }
        permitAction = context.statusManager.updateAction(
          context.step,
          permitAction.type,
          'ACTION_REQUIRED'
        )
        if (!(params.allowUserInteraction ?? false)) {
          result = { status: 'ACTION_REQUIRED' }
          break
        }
        const typedDataChainId =
          getDomainChainId(typedData.domain) || context.step.action.fromChainId
        const permitClient = await params.checkClient(
          context.step,
          permitAction,
          typedDataChainId
        )
        if (!permitClient) {
          result = { status: 'ACTION_REQUIRED' }
          break
        }
        const signature = await getAction(
          permitClient,
          signTypedData,
          'signTypedData'
        )({
          account: permitClient.account!,
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        })
        const signedPermit: SignedTypedData = {
          ...typedData,
          signature: signature as Hex,
        }
        signedTypedData.push(signedPermit)
        permitAction = context.statusManager.updateAction(
          context.step,
          permitAction.type,
          'ACTION_REQUIRED',
          { signedTypedData }
        )
      }
      if (!result) {
        context.statusManager.updateAction(
          context.step,
          permitAction!.type,
          'DONE',
          { signedTypedData }
        )
        const matchingPermit = signedTypedData.find(
          (s) => getDomainChainId(s.domain) === context.step.action.fromChainId
        )
        if (matchingPermit) {
          result = { status: 'NATIVE_PERMIT', data: signedTypedData }
        }
      }
    }
    if (result) {
      context.allowanceFlow.result = result
      applyAllowanceResultToContext(context, result)
      if (
        result.status === 'ACTION_REQUIRED' &&
        !context.allowUserInteraction
      ) {
        return {
          status: 'PAUSED',
          data: { allowanceFlow: context.allowanceFlow! },
        }
      }
    }
    return {
      status: 'COMPLETED',
      data: { allowanceFlow: context.allowanceFlow! },
    }
  }
}
