/**
 * Check if a hex string is a signature (65 bytes = 130 hex chars + 0x prefix = 132 chars)
 * vs a transaction hash (32 bytes = 64 hex chars + 0x prefix = 66 chars)
 */
export function isSignature(hash: string): boolean {
  return hash.startsWith('0x') && hash.length > 66
}
