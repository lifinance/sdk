import type { TransactionMethodType } from '@lifi/sdk'
import { isBatchingSupported } from '../../../actions/isBatchingSupported.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { isGaslessStep } from '../../../utils/isGaslessStep.js'
import { isRelayerStep } from '../../../utils/isRelayerStep.js'

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
  // Only route to the relayer when the step's typed data is actually a gasless
  // intent (a Permit2 witness, or a permit whose spender is Permit2 itself).
  // A step can carry typed data that is meant to be signed and then sent by the
  // user in a normal transaction — e.g. a Permit2 `PermitSingle` for a non-LI.FI
  // spender embedded into the step's own tx by `getStepTransaction`. Those must
  // execute as `standard`, matching the gating already used in `getUpdatedStep`.
  if (isRelayerStep(step) && isGaslessStep(step, fromChain)) {
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
