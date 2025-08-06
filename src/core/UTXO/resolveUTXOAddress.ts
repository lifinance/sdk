export async function resolveUTXOAddress(
  name: string
): Promise<string | undefined> {
  // Not supported on UTXO yet
  return name
}
