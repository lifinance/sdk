import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import {
  getTypedDataLane,
  hasCallerIntent,
  hasRelayerIntent,
} from '../../utils/getTypedDataLane.js'
import { signTypedDataEntries } from './helpers/signTypedDataEntries.js'

/**
 * Signs the Permit2 messages a custom provider attached to its own step, for
 * its own spender, before the transaction is prepared. `getStandardUpdatedStep`
 * threads the signatures into `/advanced/stepTransaction`, which returns router
 * calldata with the signature embedded, so the user sends one ordinary
 * transaction.
 *
 * Runs after the allowance tasks: unlike a native EIP-2612 permit, a Permit2
 * `PermitSingle` does not stand in for the ERC-20 allowance, so the
 * token -> Permit2 approval has to land first. Running after the balance check
 * also avoids a wallet prompt that a failing balance check would waste.
 *
 * No dedupe against `context.signedTypedData`: `BaseStepExecutor` rebuilds the
 * context on every `executeStep`, so it restarts empty on a resume, and no
 * earlier task adds a caller-intent entry.
 */
export class EthereumSignStepIntentTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    // `&& !hasRelayerIntent`: the lanes are NOT mutually exclusive, and a step
    // carrying both belongs to the relayer. `getUpdatedStep` sends such a step
    // to `getRelayerUpdatedStep`, which takes no `signedTypedData` and
    // re-quotes, so a signature collected here is discarded — and if the
    // re-quote echoes the `PermitSingle`, `EthereumRelayedSignAndExecuteTask`
    // asks for it again. Signing here would cost the user a second prompt for
    // nothing.
    return (
      hasCallerIntent(step, fromChain) &&
      !hasRelayerIntent(step, fromChain) &&
      !disableMessageSigning
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

    const intentTypedData =
      step.typedData?.filter(
        (typedData) =>
          getTypedDataLane(typedData, fromChain) === 'caller-intent'
      ) ?? []

    const result = await signTypedDataEntries(
      context,
      intentTypedData,
      action.type
    )
    if (result.status === 'PAUSED') {
      return { status: 'PAUSED' }
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: { signedTypedData: result.signedTypedData },
    }
  }
}
