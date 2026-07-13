import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { type Hex, isHex } from 'viem'

/**
 * Checks that a wallet-returned signature is a usable hex string.
 * Some wallets can resolve `signTypedData` with a nullish or empty ('0x')
 * value instead of rejecting.
 * Signature length is intentionally not validated: 65-byte, EIP-2098 compact
 * and arbitrary-length smart account (ERC-1271) signatures are all valid.
 */
export function isValidSignature(
  signature: Hex | null | undefined
): signature is Hex {
  return isHex(signature) && signature !== '0x'
}

export function assertValidSignature(
  signature: Hex | null | undefined
): asserts signature is Hex {
  if (!isValidSignature(signature)) {
    throw new TransactionError(
      LiFiErrorCode.SignatureRejected,
      'Wallet did not return a valid signature.'
    )
  }
}
