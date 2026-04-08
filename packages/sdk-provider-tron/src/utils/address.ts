import { TronWeb } from 'tronweb'

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
