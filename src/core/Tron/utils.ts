import { TronWeb } from 'tronweb'

/**
 * Check if the given address is a valid Tron address
 * @param address - The address to validate
 * @returns True if the address is valid, false otherwise
 */
export function isValidTronAddress(address: string): boolean {
  try {
    return TronWeb.isAddress(address)
  } catch {
    return false
  }
}

/**
 * Convert a Tron address to its hex format
 * @param address - The Tron address to convert
 * @returns The hex format of the address
 */
export function tronAddressToHex(address: string): string {
  return TronWeb.address.toHex(address)
}

/**
 * Convert a hex address to Tron address format
 * @param hexAddress - The hex address to convert
 * @returns The Tron address format
 */
export function hexToTronAddress(hexAddress: string): string {
  return TronWeb.address.fromHex(hexAddress)
}

/**
 * Get the base58 address from a hex address
 * @param hexAddress - The hex address
 * @returns The base58 address
 */
export function getBase58Address(hexAddress: string): string {
  return TronWeb.address.fromHex(hexAddress)
}

/**
 * Get the hex address from a base58 address
 * @param base58Address - The base58 address
 * @returns The hex address
 */
export function getHexAddress(base58Address: string): string {
  return TronWeb.address.toHex(base58Address)
}
