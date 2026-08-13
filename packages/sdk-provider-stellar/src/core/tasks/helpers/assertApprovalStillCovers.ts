import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../../types.js'
import { readAllowance } from './readAllowance.js'
import { resolveApprovalRequirement } from './resolveApprovalRequirement.js'

/**
 * Fails the step before signing when the refreshed route needs an allowance the
 * sender does not have.
 *
 * `StellarPrepareTransactionTask` re-quotes after `StellarSetAllowanceTask` has
 * already written an allowance, and the re-quote replaces `includedSteps` and
 * `estimate` wholesale. A fresh quote that names a different adapter, a
 * different intermediate token, or a larger amount would revert `transfer_from`
 * on-chain after a second signature.
 *
 * The check reads the chain rather than comparing against the resolved
 * requirement: when the allowance already existed, the on-chain ceiling can be
 * far above what this route asked for, and comparing the two would reject a
 * route that works.
 */
export const assertApprovalStillCovers = async (
  context: StellarStepExecutorContext
): Promise<void> => {
  // Nothing was resolved before the refresh, so there is no grant to invalidate.
  if (!context.approval) {
    return
  }

  const refreshed = resolveApprovalRequirement(context.step)
  if (!refreshed) {
    return
  }

  const allowance = await readAllowance(
    context.client,
    refreshed.tokenAddress,
    context.wallet.address,
    refreshed.spender,
    context.networkPassphrase
  )

  if (allowance < refreshed.amount) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'The refreshed Stellar route needs a token allowance the sender has not granted. Please request a new route.'
    )
  }
}
