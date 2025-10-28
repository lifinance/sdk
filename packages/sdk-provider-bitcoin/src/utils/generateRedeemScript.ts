import { payments } from 'bitcoinjs-lib'

/**
 * Generate redeem script for P2SH addresses
 * @param publicKey
 * @returns redeem script
 */
export const generateRedeemScript = (publicKey: Uint8Array) =>
  // P2SH addresses are created by hashing the public key and using the result as the script
  payments.p2wpkh({ pubkey: publicKey }).output
