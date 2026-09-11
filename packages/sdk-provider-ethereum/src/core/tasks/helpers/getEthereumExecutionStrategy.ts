import type { TransactionMethodType } from '@lifi/sdk'
import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { isCallerIntentLane } from '../../../utils/getTypedDataLane.js'

/**
 * Determines the execution strategy: 'relayed', 'batched', or 'standard'.
 * Falls back to 'standard' when EIP-5792 batching is unavailable,
 * the wallet rejected the 7702 upgrade, or the tool doesn't support it.
 */
export async function getEthereumExecutionStrategy(
  context: EthereumStepExecutorContext,
  forceRecalculate: boolean = false
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

  if (!forceRecalculate && executionStrategyContext) {
    return executionStrategyContext
  }

  const atomicityNotReady = !!retryParams?.atomicityNotReady
  // Typed data belongs to the relayer unless it is exclusively a caller intent:
  // that is the one shape the user signs and then sends themselves. The
  // `executionType` term is an OR, not a replacement — it closes the routes-time
  // window where the backend declares a message flow before `typedData` arrives.
  if (
    step.executionType === 'message' ||
    (!!step.typedData?.length && !isCallerIntentLane(step, fromChain))
  ) {
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
