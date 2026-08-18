import type { SDKClient } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Signature,
  type Transaction,
} from '@solana/kit'
import { confirmSignature } from '../confirmation/confirmSignature.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import type { SignatureStatus } from '../confirmation/types.js'
import { getSolanaRpcs } from '../rpc/registry.js'
import type { SolanaRpcType } from '../rpc/types.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

export type ConfirmedTransactionResult = {
  result: RaceResult<SignatureStatus>
  txSignature: Signature
}

/**
 * Sends a Solana transaction to every configured RPC and returns as soon as
 * one of them confirms it.
 *
 * The polling horizon comes from the signed transaction's own blockhash and a
 * wall-clock ceiling. It deliberately never comes from `getBlockHeight`: at
 * least one endpoint in the default LI.FI set answers that call with the slot
 * number.
 */
export async function sendAndConfirmTransaction(
  client: SDKClient,
  signedTransaction: Transaction
): Promise<ConfirmedTransactionResult> {
  const solanaRpcs = await getSolanaRpcs(client)

  const signedTxSerialized = getBase64EncodedWireTransaction(signedTransaction)
  const txSignature = getSignatureFromTransaction(signedTransaction)

  if (!txSignature) {
    throw new Error('Transaction signature is missing.')
  }

  const lifetime = await getTransactionLifetime(signedTransaction)

  const rawTransactionOptions = {
    // We can skip preflight check after the first transaction has been sent
    // https://solana.com/docs/advanced/retry#the-cost-of-skipping-preflight
    skipPreflight: true,
    // Setting max retries to 0 as we are handling retries manually
    maxRetries: BigInt(0),
    // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
    preflightCommitment: 'confirmed' as Commitment,
    encoding: 'base64' as const,
  }

  const resend = async (
    rpc: SolanaRpcType,
    signal: AbortSignal
  ): Promise<void> => {
    await rpc
      .sendTransaction(signedTxSerialized, rawTransactionOptions)
      .send({ abortSignal: signal })
  }

  const result = await raceRpcs(
    solanaRpcs,
    (rpc, signal) =>
      confirmSignature({
        rpc,
        signal,
        signature: txSignature,
        lifetimes: [lifetime],
        resend,
      }),
    { timeoutMs: BRANCH_TIMEOUT_MS }
  )

  return { result, txSignature }
}
