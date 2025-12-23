import { getBase58Codec } from '@solana/kit'

const nativeCrypto = globalThis.crypto

// Helper to generate a valid test keypair
export const generateTestKeypair = async () => {
  if (!nativeCrypto?.subtle) {
    throw new Error('SubtleCrypto is not available in this environment')
  }

  const base58Codec = getBase58Codec()
  const keyPair = await nativeCrypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )

  const privateKeyPkcs8 = new Uint8Array(
    await nativeCrypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  )
  const privateKeyBytes = privateKeyPkcs8.slice(-32)
  const publicKey = new Uint8Array(
    await nativeCrypto.subtle.exportKey('raw', keyPair.publicKey)
  )
  const secretKey = new Uint8Array([...privateKeyBytes, ...publicKey])

  return {
    secretKey: base58Codec.decode(secretKey),
    publicKey,
  }
}
