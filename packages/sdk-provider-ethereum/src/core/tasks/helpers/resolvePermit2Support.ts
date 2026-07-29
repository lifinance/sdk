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
 * On top of the step/chain checks this verifies that the *signer* can actually
 * produce a Permit2-verifiable signature — see {@link canAccountUsePermit2}.
 * Accounts with on-chain code send Permit2 down its EIP-1271 path, where
 * whether our plain ECDSA signature is accepted depends on the account
 * implementation, so it is probed rather than assumed. Accounts that reject it
 * fall back to approve + execute.
 *
 * Named `resolve…` rather than `is…` because it is not a pure predicate: the
 * signer verdict is memoized onto `context.permit2SignerSupported`.
 * `TaskPipeline` threads one context object through the whole run, so every
 * task in a single execution agrees on the answer and only one `eth_getCode`
 * is issued — without that, a wallet gaining or losing its 7702 delegation
 * mid-swap could have the allowance tasks approve Permit2 while the
 * sign-and-execute task routes to the diamond, which then has no allowance.
 *
 * Resolved lazily, after the cheap checks, so steps that can never use Permit2
 * (native token, batched, `skipPermit`, …) don't pay for the RPC at all.
 */
export const resolvePermit2Support = async (
  context: EthereumStepExecutorContext,
  strategy: TransactionMethodType
): Promise<boolean> => {
  if (!isPermit2SupportedForStep(context, strategy)) {
    return false
  }

  const { client, step, fromChain, ethereumClient } = context
  const address = (step.action.fromAddress ??
    ethereumClient.account?.address) as Address | undefined
  if (!address) {
    return false
  }

  // Safe to cache the promise: `canAccountUsePermit2` resolves `false` on RPC
  // failure rather than rejecting, so this can never memoize a rejection.
  context.permit2SignerSupported ??= canAccountUsePermit2(client, {
    chainId: fromChain.id,
    address,
  })

  return context.permit2SignerSupported
}
