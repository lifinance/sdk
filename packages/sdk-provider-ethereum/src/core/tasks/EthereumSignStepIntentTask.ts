import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import {
  getTypedDataInLane,
  isCallerIntentLane,
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
 *
 * Known limitation — action attribution in the native-permit + caller-intent
 * cell. The task reuses the `PERMIT` action so the widget needs no change.
 * `initializeAction` reuses an action of the same type, so in the cell where
 * `EthereumCheckPermitsTask` already completed a `PERMIT` action, that action
 * is reset and re-sorted behind the `SWAP` action the balance check created.
 * `BaseStepExecutor` attributes a thrown error to the last action, so a
 * rejected intent signature is reported against `SWAP`. It is recoverable — a
 * resume resets FAILED to PENDING — and the alternatives are a new public
 * action type, which needs widget coordination, or moving this task ahead of
 * the balance check, which would prompt for a signature the user may not be
 * able to use.
 */
export class EthereumSignStepIntentTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning } = context

    return isCallerIntentLane(step, fromChain) && !disableMessageSigning
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, fromChain, statusManager } = context

    const action = statusManager.initializeAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const intentTypedData = getTypedDataInLane(step, 'caller-intent', fromChain)

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
