import type { Psbt } from 'bitcoinjs-lib'

export function isPsbtFinalized(psbt: Psbt): boolean {
  try {
    psbt.extractTransaction()
    return true
  } catch (_) {
    return false
  }
}

export const toXOnly = (pubKey: Uint8Array) =>
  pubKey.length === 32 ? pubKey : pubKey.subarray(1, 33)
