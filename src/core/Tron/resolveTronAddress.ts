import { isValidTronAddress } from './utils.js'

/**
 * Resolve a Tron address - validates and returns the address
 * @param address - The address to resolve
 * @returns The resolved address
 */
export async function resolveTronAddress(address: string): Promise<string> {
  if (!isValidTronAddress(address)) {
    throw new Error(`Invalid Tron address: ${address}`)
  }
  return address
}
