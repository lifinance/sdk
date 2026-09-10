import { type CheckBalanceOptions, CheckBalanceTask } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAccountCode } from '../../actions/getAccountCode.js'
import { isSmartContractWalletCode } from '../../actions/isSmartContractWallet.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import {
  hasCallerIntent,
  hasRelayerIntent,
} from '../../utils/getTypedDataLane.js'

/**
 * Skips the outer-tx gas check for steps where the wallet doesn't fund it:
 * smart-contract wallets (Safe Apps, 4337, 7579, …) where the
 * executor / bundler / paymaster pays, and every typed-data step except the
 * one shape that demonstrably belongs to the user — a caller-supplied Permit2
 * intent with no relayer intent beside it. The user sends and funds that
 * transaction. Source amount and non-included native fees are still verified.
 *
 * Skip-bias is intentional: a wrong skip is caught by the wallet rejecting
 * the tx; a wrong enforce blocks a tx that would have succeeded.
 */
export class EthereumCheckBalanceTask extends CheckBalanceTask {
  protected override async getCheckBalanceOptions(
    context: EthereumStepExecutorContext
  ): Promise<CheckBalanceOptions> {
    const { client, step, fromChain } = context

    // The user demonstrably funds the transaction only when the step carries a
    // caller-supplied intent and nothing headed for the relayer. Every other
    // typed-data shape keeps the historical skip: this task runs BEFORE
    // prepare, so a step carrying only a native `Permit` may still come back
    // from `/advanced/stepTransaction` as an `Order` the relayer pays for, and
    // the two are indistinguishable here. Skip-bias is deliberate — a wrong
    // skip is caught by the wallet rejecting the tx, a wrong enforce blocks a
    // tx that would have succeeded.
    const userFundsTransaction =
      hasCallerIntent(step, fromChain) && !hasRelayerIntent(step, fromChain)
    if (step.typedData?.length && !userFundsTransaction) {
      return { walletPaysGas: false }
    }

    // Funding wallet (NOT signer) — for Safe Apps these usually match, but
    // the balance question is about the funder. Compare with
    // `canAccountUseNativePermits`, which uses the signer.
    const fromAddress = step.action.fromAddress as Address | undefined
    if (!fromAddress) {
      return {}
    }

    // `step.action.fromChainId` (NOT wallet's connected chain) so cross-
    // chain / post-chain-switch flows query the chain that executes the step.
    const code = await getAccountCode({
      client,
      chainId: step.action.fromChainId,
      address: fromAddress,
    })

    // `code === undefined` on RPC failure → falls through to "treat as EOA"
    // since `isSmartContractWalletCode(undefined)` is `false` (conservative:
    // strict gas check stays on, today's behavior).
    return { walletPaysGas: !isSmartContractWalletCode(code) }
  }
}
