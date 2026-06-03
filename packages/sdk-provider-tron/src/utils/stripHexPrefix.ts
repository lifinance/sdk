export const stripHexPrefix = (value: string): string =>
  value.replace(/^0x/, '')
