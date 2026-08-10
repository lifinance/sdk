import type { LiFiStep } from '@lifi/sdk'
import { StrKey } from '@stellar/stellar-sdk'
import type { StellarApprovalRequirement } from '../../../types.js'

/**
 * Extra head-room, in percent, added on top of the leg's quoted `fromAmount`
 * when the allowance is written.
 */
const APPROVAL_AMOUNT_BUFFER_PERCENT = 10n

/**
 * Resolves the SAC allowance a Stellar step needs, or `undefined` when it needs
 * none.
 *
 * The decision is made per **included leg**, never from `step.estimate`. Unlike
 * an EVM step — one transaction whose top-level estimate describes the approval
 * — a Stellar route is a single router invocation composed of several legs, and
 * the leg that pulls funds is the one whose spender and token the allowance has
 * to name. The route-level `estimate.approvalAddress` is only a summary and
 * falls back to a placeholder (a `G` wallet, or the EVM diamond), so honouring
 * it would approve a contract nobody ever charges.
 *
 * A leg is taken to need an allowance unless it says otherwise: only an
 * explicit `skipApproval: true` opts out, matching how the EVM and Tron
 * executors read the same flag. Legs that move funds with SAC `transfer` under
 * the sender's top-level `require_auth` — fee collection, soroswap — set it;
 * a leg that pulls with `transfer_from`, such as the CCTP cross, leaves it
 * unset or false and so gets an approval.
 *
 * The leg also carries the right token and amount: for swap→CCTP the allowance
 * is written against the intermediate USDC the swap produces, not the route's
 * `fromToken`.
 */
export const resolveApprovalRequirement = (
  step: LiFiStep
): StellarApprovalRequirement | undefined => {
  // The pipeline grants at most one allowance per step, so the first leg that
  // needs one wins. Routes today ask for a single approval; a route whose legs
  // pull two different tokens would need the executor to loop instead.
  const includedStep = step.includedSteps?.find(
    (includedStep) => !includedStep.estimate.skipApproval
  )
  if (!includedStep) {
    return undefined
  }

  const spender = includedStep.estimate.approvalAddress
  // A spender has to be a real Soroban contract (`C`) address. Anything else —
  // a `G` wallet, an EVM address — cannot call `transfer_from`, so approving it
  // would be a wasted signature rather than a step towards a working route.
  if (!spender || !StrKey.isValidContract(spender)) {
    return undefined
  }

  // `fromAmount` is a quote-time figure. A leg fed by an upstream swap is handed
  // whatever that swap actually produced, which can land above the quote, and
  // `transfer_from` reverts the whole invocation if the allowance is short by
  // even a stroop. The buffer absorbs that drift and costs nothing: an allowance
  // is a ceiling, so only the amount actually pulled is ever spent.
  //
  // Read off `estimate`, the same object `skipApproval` and `approvalAddress`
  // come from. `CheckBalanceTask`'s slippage rescue revises `action.fromAmount`
  // on the first leg only, and only downward, so the estimate stays an upper
  // bound either way.
  const amount = BigInt(includedStep.estimate.fromAmount)

  return {
    spender,
    tokenAddress: includedStep.action.fromToken.address,
    amount: amount + (amount * APPROVAL_AMOUNT_BUFFER_PERCENT) / 100n,
  }
}
