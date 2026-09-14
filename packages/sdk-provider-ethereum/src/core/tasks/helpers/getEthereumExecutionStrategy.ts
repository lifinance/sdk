import type { TransactionMethodType } from '@lifi/sdk'
import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { isCallerIntentLane } from '../../../utils/getTypedDataLane.js'

/**
 * Determines the execution strategy: 'relayed', 'batched', or 'standard'.
 * Falls back to 'standard' when EIP-5792 batching is unavailable,
 * the wallet rejected the 7702 upgrade, or the tool doesn't support it.
 *
 * `afterPrepare` marks the single call from `EthereumPrepareTransactionTask`.
 * The step has just been re-quoted, so the cached verdict is stale and, for the
 * first time, the absence of a `transactionRequest` is final rather than merely
 * not-yet-known. Both effects come from that one fact, which is why they share
 * a parameter.
 */
export async function getEthereumExecutionStrategy(
  context: EthereumStepExecutorContext,
  afterPrepare: boolean = false
): Promise<TransactionMethodType> {
  const {
    step,
    checkClient,
    retryParams,
    client,
    fromChain,
    ethereumClient,
    executionStrategy: executionStrategyContext,
  } = context

  if (!afterPrepare && executionStrategyContext) {
    return executionStrategyContext
  }

  const atomicityNotReady = !!retryParams?.atomicityNotReady
  // Declared by the backend. It is the only signal that reaches the allowance
  // tasks, which run before a `transactionRequest` can exist.
  if (step.executionType === 'message') {
    return 'relayed'
  }

  // Typed data the user does not sign for its own send: gasless, `Order`,
  // Hyperliquid. A caller intent is the one shape excluded, because its signer
  // and its sender are the same person.
  if (step.typedData?.length && !isCallerIntentLane(step, fromChain)) {
    return 'relayed'
  }

  // After prepare, missing means never: the step carries typed data and the user
  // has nothing to send, so the relayer is the only lane that can execute it.
  // This is a derivation, not a guess — no other strategy can run such a step.
  //
  // Before prepare the same expression is unsound. A caller intent that will
  // receive its transaction from `/stepTransaction` is indistinguishable from
  // one that never will, and calling it relayed there costs the step its
  // EIP-5792 batching.
  if (afterPrepare && step.typedData?.length && !step.transactionRequest) {
    return 'relayed'
  }

  if (atomicityNotReady || step.tool === 'thorswap') {
    return 'standard'
  }

  const updatedClient = (await checkClient(step)) ?? ethereumClient
  const batchingSupported = await isBatchingSupported(client, {
    client: updatedClient,
    chainId: fromChain.id,
  })
  return batchingSupported ? 'batched' : 'standard'
}
