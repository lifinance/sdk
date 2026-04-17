export type Hex = `0x${string}`

export function isHex(
  value: unknown,
  { strict = true }: { strict?: boolean | undefined } = {}
): value is Hex {
  if (!value) {
    return false
  }
  if (typeof value !== 'string') {
    return false
  }
  return strict ? /^0x[0-9a-fA-F]*$/.test(value) : value.startsWith('0x')
}
