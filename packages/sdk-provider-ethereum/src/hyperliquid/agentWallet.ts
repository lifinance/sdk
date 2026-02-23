import type { SDKStorage } from '@lifi/sdk'
import type { LocalAccount } from 'viem'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'

const DEFAULT_STORAGE_KEY_PREFIX = 'li.fi-sdk:hyperliquid:agent'
const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000 // 1 week
const EXPIRATION_BUFFER_MS = 60 * 60 * 1000 // 1 hour

// Mnemonics are encrypted with AES-GCM using a key derived (PBKDF2) from the
// owner's wallet address. This is obfuscation and the wallet address is public,
// so anyone who knows the scheme can derive the same key. It prevents raw
// mnemonic exposure in storage but does not defend against a targeted attack.
const ENCRYPTION_SALT = 'li.fi-sdk:agent-wallet-encryption'

interface StoredAgentWallet {
  mnemonic: string
  expiresAt: number
}

export interface AgentWalletResult {
  account: LocalAccount
  needsApproval: boolean
  expiresAt: number
}

function getStorageKey(
  ownerAddress: string,
  keyPrefix = DEFAULT_STORAGE_KEY_PREFIX
): string {
  return `${keyPrefix}:${ownerAddress.toLowerCase()}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function deriveKey(ownerAddress: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ownerAddress.toLowerCase()),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(ENCRYPTION_SALT),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  )
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
  return decoder.decode(plaintext)
}

async function saveAgentWallet(
  storage: SDKStorage,
  ownerAddress: string,
  mnemonic: string,
  keyPrefix?: string
): Promise<void> {
  const key = await deriveKey(ownerAddress)
  const data: StoredAgentWallet = {
    mnemonic: await encrypt(mnemonic, key),
    expiresAt: Date.now() + DEFAULT_EXPIRATION_MS,
  }
  await storage.set(
    getStorageKey(ownerAddress, keyPrefix),
    JSON.stringify(data)
  )
}

async function loadAgentWallet(
  storage: SDKStorage,
  ownerAddress: string,
  keyPrefix?: string
): Promise<{ account: LocalAccount; expiresAt: number } | null> {
  const raw = await storage.get(getStorageKey(ownerAddress, keyPrefix))
  if (!raw) {
    return null
  }
  try {
    const data: StoredAgentWallet = JSON.parse(raw)
    const key = await deriveKey(ownerAddress)
    const mnemonic = await decrypt(data.mnemonic, key)
    return { account: mnemonicToAccount(mnemonic), expiresAt: data.expiresAt }
  } catch {
    return null
  }
}

export async function getOrCreateAgentWallet(
  storage: SDKStorage,
  ownerAddress: string,
  keyPrefix?: string
): Promise<AgentWalletResult> {
  const existing = await loadAgentWallet(storage, ownerAddress, keyPrefix)
  if (existing && existing.expiresAt - Date.now() > EXPIRATION_BUFFER_MS) {
    return {
      account: existing.account,
      needsApproval: false,
      expiresAt: existing.expiresAt,
    }
  }

  const mnemonic = generateMnemonic(english)
  const account = mnemonicToAccount(mnemonic)
  const expiresAt = Date.now() + DEFAULT_EXPIRATION_MS
  await saveAgentWallet(storage, ownerAddress, mnemonic, keyPrefix)
  return { account, needsApproval: true, expiresAt }
}
