import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { buildApproveTransaction } from './helpers/buildApproveTransaction.js'
import { deriveTransactionHash } from './helpers/deriveTransactionHash.js'
import { getStellarTxLink } from './helpers/getStellarTxLink.js'
import { submitStellarTransaction } from './helpers/submitStellarTransaction.js'
import { waitForStellarTransaction } from './helpers/waitForStellarTransaction.js'

export class StellarSetAllowanceTask extends BaseStepExecutionTask {
  override shouldRun(context: StellarStepExecutorContext): Promise<boolean> {
    return Promise.resolve(
      !!context.approvalSpender && !context.hasSufficientAllowance
    )
  }

  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      wallet,
      fromChain,
      statusManager,
      networkPassphrase,
      approvalSpender,
      allowUserInteraction,
      pollingIntervalMs,
      checkWallet,
    } = context

    const action = statusManager.initializeAction({
      step,
      type: 'SET_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    // Clear the txHash and txLink from a potential previous approval attempt
    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    checkWallet(step)

    const envelopeXdr = await buildApproveTransaction(
      client,
      step.action.fromToken.address,
      wallet.address,
      approvalSpender!,
      BigInt(step.action.fromAmount),
      networkPassphrase
    )

    const { signedTxXdr } = await wallet.signTransaction(envelopeXdr, {
      address: wallet.address,
      networkPassphrase,
    })

    // Derived locally, like the route transaction, so the hash is recorded even
    // if the submit response is lost.
    const transactionHash = deriveTransactionHash(
      signedTxXdr,
      networkPassphrase
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: transactionHash,
      txLink: getStellarTxLink(fromChain, transactionHash),
    })

    await submitStellarTransaction(client, signedTxXdr, networkPassphrase)

    // Wait for on-chain confirmation, not just acceptance. The route envelope is
    // built by the backend from a live `getAccount(sender)` read, so it must be
    // requested only after this approval has consumed the sender's sequence
    // number in a closed ledger — otherwise the backend hands back an envelope
    // carrying the pre-approval sequence and the route submission fails with
    // `tx_bad_seq`.
    await waitForStellarTransaction(client, transactionHash, pollingIntervalMs)

    statusManager.updateAction(step, action.type, 'DONE')

    return { status: 'COMPLETED', context: { hasSufficientAllowance: true } }
  }
}
