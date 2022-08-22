import { ExternalProvider } from '@ethersproject/providers'
import { Token } from '@lifi/types'
import { name, version } from './version'

declare const ethereum: ExternalProvider

const ethereumRequest = async <T>(
  method: string,
  params: string[]
): Promise<T> => {
  // If ethereum.request() exists, the provider is probably EIP-1193 compliant.
  if (!ethereum || !ethereum.request) {
    throw new Error('Provider not available.')
  }
  return ethereum.request({
    method,
    params,
  })
}

/**
 * Predefined hook that decrypts calldata using EIP-1193 compliant wallet functions.
 * @param {string} walletAddress - The wallet address of the user that should decrypt the calldata.
 * @return {(encryptedData: string) => Promise<any>} A function that decrypts data using EIP-1193 compliant wallet functions.
 */
export const getEthereumDecryptionHook = (walletAddress: string) => {
  return (encryptedData: string): Promise<string> => {
    return ethereumRequest('eth_decrypt', [encryptedData, walletAddress])
  }
}

/**
 * Predefined hook that get the public encryption key of a user using EIP-1193 compliant wallet functions.
 * @param {string} walletAddress - The wallet address of the user.
 * @return {(walletAddress: string) => () => Promise<any>} A function that return the public encryption key using EIP-1193 compliant wallet functions.
 */
export const getEthereumPublicKeyHook = (walletAddress: string) => {
  return (): Promise<string> => {
    return ethereumRequest('eth_getEncryptionPublicKey', [walletAddress])
  }
}

/**
 * Returns a random number between min (inclusive) and max (inclusive)
 */
export const getRandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

export const isSameToken = (tokenA: Token, tokenB: Token): boolean =>
  tokenA.chainId === tokenB.chainId &&
  tokenA.address.toLowerCase() === tokenB.address.toLowerCase()

function semverCompare(a: string, b: string) {
  if (a.startsWith(b + '-')) {
    return -1
  }
  if (b.startsWith(a + '-')) {
    return 1
  }
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'case',
    caseFirst: 'upper',
  })
}

export const checkPackageUpdates = async (
  packageName?: string,
  packageVersion?: string,
  disableCheck?: boolean
) => {
  if (disableCheck || process.env.NODE_ENV !== 'development') {
    return
  }
  try {
    const pkgName = packageName ?? name
    const response = await (
      await fetch(`https://unpkg.com/${pkgName}/package.json`)
    ).json()
    const latestVersion = response.version
    const currentVersion = packageVersion ?? version

    if (semverCompare(latestVersion, currentVersion)) {
      console.warn(
        // eslint-disable-next-line max-len
        `${pkgName}: new package version is available. Please update as soon as possible to enjoy the newest features. Latest version: ${latestVersion}`
      )
    }
  } catch (error) {
    // Cannot verify version, might be network error etc. We don't bother showing anything in that case
  }
}
