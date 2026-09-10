import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'
import {
  getTypedDataLane,
  hasCallerIntent,
} from '../../utils/getTypedDataLane.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    const permitTypedData = step.typedData?.filter(
      (typedData) => getTypedDataLane(typedData, fromChain) === 'native-permit'
    )

    return !!permitTypedData?.length && !disableMessageSigning
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
    const permitTypedData =
      step.typedData?.filter(
        (typedData) =>
          getTypedDataLane(typedData, fromChain) === 'native-permit'
      ) ?? []

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
        // `step.estimate.approvalAddress`. For a caller-intent-only step the
        // Permit2 gate is off, so that spender is whatever the caller named —
        // not necessarily Permit2 — and a native permit signed for
        // `permit2Proxy` does not provide it. The allowance tasks must not be
        // skipped even with a native permit in hand.
        hasMatchingPermit:
          !!matchingPermit && !hasCallerIntent(step, fromChain),
      },
    }
  }
}
