import type { TransactionMethodType } from '@lifi/sdk'
import type { Address } from 'viem'
import { canAccountUsePermit2 } from '../../../permits/canAccountUsePermit2.js'
import type { EthereumStepExecutorContext } from '../../../types.js'

/**
 * Cheap, synchronous part of the gate: does the step/chain combination allow
 * the Permit2 flow at all? Permit2 should not be available for atomic batch.
 */
const isPermit2SupportedForStep = (
  context: EthereumStepExecutorContext,
  strategy: TransactionMethodType
): boolean => {
  const { step, fromChain, isFromNativeToken, disableMessageSigning } = context

  return (
    !!fromChain.permit2 &&
    !!fromChain.permit2Proxy &&
    !isFromNativeToken &&
    !disableMessageSigning &&
    strategy !== 'batched' &&
    // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    !step.estimate.skipPermit
  )
}

/**
 * Whether this step should use the Permit2 signature flow.
 *
 * Beyond the step/chain checks, the `standard` strategy also probes the
 * *signer*: code-bearing accounts send Permit2 down its EIP-1271 path, where
 * acceptance is implementation-specific — see {@link canAccountUsePermit2}.
 * Accounts that fail it fall back to approve + execute.
 *
 * Only `standard` consults the probe. `signPermit2Message` has one call site,
 * `EthereumStandardSignAndExecuteTask`, so that is the only flow where the SDK
 * produces the Permit2 signature itself. A relayed step has no approve +
 * execute fallback, so a verdict cannot rescue a failing account and would
 * break a working one — it must never move the spender off `fromChain.permit2`.
 *
 * The verdict is memoized on `context.permit2SignerSupported`, and a `false`
 * stays sticky, a failed lookup included. `TaskPipeline` threads one context
 * through every task, so a mid-run flip would let the allowance tasks approve
 * one spender while the sign task routes to the other — turning a needless
 * approval into a revert.
 */
export const resolvePermit2Support = async (
  context: EthereumStepExecutorContext,
  strategy: TransactionMethodType
): Promise<boolean> => {
  if (!isPermit2SupportedForStep(context, strategy)) {
    return false
  }

  // Only `standard` consults the probe; `batched` is excluded above.
  if (strategy !== 'standard') {
    return true
  }

  const { client, step, fromChain, ethereumClient } = context
  const address = (step.action.fromAddress ??
    ethereumClient.account?.address) as Address | undefined
  if (!address) {
    return false
  }

  // Caching the promise is safe: `canAccountUsePermit2` never rejects.
  context.permit2SignerSupported ??= canAccountUsePermit2(client, {
    chainId: fromChain.id,
    address,
  })

  return context.permit2SignerSupported
}
