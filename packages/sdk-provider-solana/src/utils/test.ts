import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'

// Helper to generate a valid test keypair
export const generateTestKeypair = () => {
  const privateKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  const secretKey = new Uint8Array([...privateKey, ...publicKey])
  return {
    privateKey: bs58.encode(secretKey),
    publicKey,
  }
}
