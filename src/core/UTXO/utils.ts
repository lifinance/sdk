import { ChainId as BigmiChainId } from '@bigmi/core'
import { ChainId } from '@lifi/types'
import { type Psbt, payments } from 'bitcoinjs-lib'

export function isPsbtFinalized(psbt: Psbt): boolean {
  try {
    psbt.extractTransaction()
    return true
  } catch (_) {
    return false
  }
}

// helper function to convert full public key (33 bytes) to x-only compressed format (32 bytes) required after taproot update
export const toXOnly = (pubKey: Uint8Array) =>
  pubKey.length === 32 ? pubKey : pubKey.subarray(1, 33)

export const toBigmiChainId = (chainId: ChainId): BigmiChainId => {
  switch (chainId) {
    case ChainId.BTC:
      return BigmiChainId.BITCOIN_MAINNET
    default:
      throw new Error(`Unsupported chainId mapping: ${chainId}`)
  }
}

/**
 * Generate redeem script for P2SH addresses
 * @param publicKey
 * @returns redeem script
 */
export const generateRedeemScript = (publicKey: Uint8Array) =>
  // P2SH addresses are created by hashing the public key and using the result as the script
  payments.p2wpkh({ pubkey: publicKey }).output
