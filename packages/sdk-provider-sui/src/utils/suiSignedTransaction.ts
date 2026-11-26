import { bcs } from '@mysten/sui/bcs'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'

export interface SuiSignedTransaction {
  /** The BCS `TransactionData` bytes that were signed. */
  bytes: Uint8Array
  /** The serialized signature returned by `signer.signTransaction`. */
  signature: string
  /** The transaction digest, derived from `bytes`. */
  digest: string
}

/**
 * Reads a signed transaction back from `ExecutionAction.txHex`
 * (JSON `{ bytes: base64, signature }`).
 *
 * Returns `undefined` unless the bytes decode as a `TransactionData` and the
 * signature decodes as non-empty base64, so the digest and the re-execution
 * both work.
 */
export function parseSuiSignedTransaction(
  txHex: string
): SuiSignedTransaction | undefined {
  try {
    const { bytes, signature } = JSON.parse(txHex) as {
      bytes?: unknown
      signature?: unknown
    }
    if (typeof bytes !== 'string' || typeof signature !== 'string') {
      return undefined
    }
    const transactionBytes = fromBase64(bytes)
    // The gRPC client decodes the signature before it sends, so a signature
    // that is not base64 never reaches the chain. `fromBase64('')` is an
    // empty array, not an error.
    if (!transactionBytes.length || !fromBase64(signature).length) {
      return undefined
    }
    // Throws on anything that is not a `TransactionData`.
    TransactionDataBuilder.fromBytes(transactionBytes)
    // `fromBytes` reads a `TransactionData` prefix and ignores the bytes after
    // it, which still change the digest.
    if (!isCanonicalTransactionData(transactionBytes)) {
      return undefined
    }
    return {
      bytes: transactionBytes,
      signature,
      digest: TransactionDataBuilder.getDigestFromBytes(transactionBytes),
    }
  } catch {
    return undefined
  }
}

/** Whether the canonical BCS encoding of the parsed bytes is exactly `bytes`. */
function isCanonicalTransactionData(bytes: Uint8Array): boolean {
  const canonical = bcs.TransactionData.serialize(
    bcs.TransactionData.parse(bytes)
  ).toBytes()
  return (
    canonical.length === bytes.length &&
    canonical.every((byte, index) => byte === bytes[index])
  )
}

/**
 * Verifies on a node that `signature` signs `bytes` and that the signer may
 * sign for the sender of the transaction, so stored bytes that were changed
 * after signing are detected. The node also verifies zkLogin signatures (also
 * as multisig members) and signatures from the sender's address aliases,
 * which a local check rejects.
 *
 * Resolves `false` only for a definite failure: the bytes have no sender, or
 * the node answers that the signature is malformed, is not valid for the
 * bytes, or may not sign for the sender. Rejects when the verification
 * cannot run (a network error, an abort, a node that cannot check address
 * aliases), so that such a failure never counts as damaged bytes.
 */
export async function verifySuiSignedTransaction(
  transaction: SuiSignedTransaction,
  suiClient: ClientWithCoreApi,
  signal?: AbortSignal
): Promise<boolean> {
  let sender: string | null
  try {
    sender = TransactionDataBuilder.fromBytes(transaction.bytes).sender
  } catch {
    return false
  }
  if (!sender) {
    return false
  }
  const { valid } = await suiClient.core.verifySignature({
    transaction: transaction.bytes,
    signature: transaction.signature,
    address: sender,
    signal,
  })
  return valid
}

/**
 * Serializes signed transaction bytes for `ExecutionAction.txHex`.
 *
 * Returns `undefined` when the result would not read back with
 * `parseSuiSignedTransaction`, so a stored value is always usable on resume.
 */
export function serializeSuiSignedTransaction(
  bytes: Uint8Array,
  signature: string
): string | undefined {
  const txHex = JSON.stringify({ bytes: toBase64(bytes), signature })
  return parseSuiSignedTransaction(txHex) ? txHex : undefined
}
