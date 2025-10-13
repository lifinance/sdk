export async function resolveBitcoinAddress(
  name: string
): Promise<string | undefined> {
  // Not supported on UTXO yet
  return name
}
