import { TronWeb } from 'tronweb'

// TronWeb.address.toHex returns a 41-prefixed hex string for valid Tron base58 addresses.
// Replacing the leading '41' with '0x' yields the standard EVM-format hex address.
export function toEvmHex(tronAddress: string): string {
  return TronWeb.address.toHex(tronAddress).replace(/^41/, '0x')
}

export function encodeAddressCalldata(
  selector: string,
  address: string
): string {
  // Pad 20-byte address to 32 bytes, left-padded with zeros
  const addr = address.replace(/^0x/, '').padStart(64, '0')
  return `0x${selector}${addr}`
}
