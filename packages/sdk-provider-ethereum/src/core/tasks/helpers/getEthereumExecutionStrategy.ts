import type { TransactionMethodType } from '@lifi/sdk'
import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { isPermit2AllowanceLane } from '../../../utils/getTypedDataLane.js'

/**
 * Retry param set by `EthereumPrepareTransactionTask` when prepare moved a step
 * off `batched` and the allowance work done for the batch — queued calls, or an
 * allowance checked against the batch spender — does not hold in the new
 * strategy. It carries the strategy prepare established, so the replay starts
 * in it. Prepare never sets it to `batched`.
 */
export const STRATEGY_AFTER_PREPARE = 'strategyAfterPrepare'

// A `Record` over the union, so a new strategy fails to compile here instead of
// being ignored by the replay.
const TRANSACTION_METHOD_TYPES: Record<TransactionMethodType, true> = {
  standard: true,
  relayed: true,
  batched: true,
}

const isTransactionMethodType = (
  value: unknown
): value is TransactionMethodType =>
  typeof value === 'string' && Object.hasOwn(TRANSACTION_METHOD_TYPES, value)

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

  // The replay of a step whose first attempt learned its strategy only at
  // prepare. Before prepare nothing on the step says so — that is why the first
  // attempt queued its calls — so the verdict comes from the retry. Prepare
  // still decides again from its own re-quote.
  const strategyAfterPrepare = retryParams?.[STRATEGY_AFTER_PREPARE]
  if (!afterPrepare && isTransactionMethodType(strategyAfterPrepare)) {
    return strategyAfterPrepare
  }

  const atomicityNotReady = !!retryParams?.atomicityNotReady
  // Declared by the backend. It is the only signal that reaches the allowance
  // tasks, which run before a `transactionRequest` can exist.
  if (step.executionType === 'message') {
    return 'relayed'
  }

  // Typed data the user does not sign for its own send: gasless, `Order`,
  // Hyperliquid. A Permit2 allowance is the one shape excluded, because its signer
  // and its sender are the same person.
  if (step.typedData?.length && !isPermit2AllowanceLane(step, fromChain)) {
    return 'relayed'
  }

  // After prepare, missing means never: the step carries typed data and the user
  // has nothing to send, so the relayer is the only lane that can execute it.
  // This is a derivation, not a guess — no other strategy can run such a step.
  //
  // Before prepare the same expression is unsound. A Permit2 allowance that will
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
