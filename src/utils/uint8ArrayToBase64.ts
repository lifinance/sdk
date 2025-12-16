export function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  // Browser environment
  const binaryString = Array.from(bytes, (byte) =>
    String.fromCharCode(byte)
  ).join('')
  return btoa(binaryString)
}
