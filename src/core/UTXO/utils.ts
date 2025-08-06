import type { Psbt } from 'bitcoinjs-lib'

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
