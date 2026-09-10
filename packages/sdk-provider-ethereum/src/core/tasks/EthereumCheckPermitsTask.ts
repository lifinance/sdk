import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import {
  getTypedDataInLane,
  getTypedDataLane,
  isCallerIntentLane,
} from '../../utils/getTypedDataLane.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    return (
      !!step.typedData?.some(
        (typedData) =>
          getTypedDataLane(typedData, fromChain) === 'native-permit'
      ) && !disableMessageSigning
    )
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, fromChain, statusManager } = context

    const action = statusManager.initializeAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    // Only native EIP-2612 permits are signed here. Caller-supplied Permit2
    // intents belong to EthereumSignStepIntentTask, which runs after the
    // allowance work.
    const permitTypedData = getTypedDataInLane(step, 'native-permit', fromChain)

    const result = await signTypedDataEntries(
      context,
      permitTypedData,
      action.type
    )
    if (result.status === 'PAUSED') {
      return { status: 'PAUSED' }
    }
    const { signedTypedData } = result

    // Only a native EIP-2612 permit stands in for the ERC-20 allowance.
    const matchingPermit = signedTypedData.find(
      (entry) =>
        entry.primaryType === 'Permit' &&
        getDomainChainId(entry.domain) === step.action.fromChainId
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        signedTypedData,
        // A caller's Permit2 intent still needs its own ERC-20 approval to
        // `step.estimate.approvalAddress`. On the caller-intent lane the
        // Permit2 gate is off, so that spender is whatever the caller named,
        // and a native permit signed for `permit2Proxy` does not provide it.
        // A mixed-lane step keeps the gate and the historical skip: it belongs
        // to the relayer, and the opposite behaviour asks a gasless user to
        // fund an approval they do not owe.
        hasMatchingPermit:
          !!matchingPermit && !isCallerIntentLane(step, fromChain),
      },
    }
  }
}
