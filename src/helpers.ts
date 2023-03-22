import { ExternalProvider } from '@ethersproject/providers'
import { LifiStep, Route, Step, Token } from '@lifi/types'
import ConfigService from './services/ConfigService'
import { HTTPError, ValidationError } from './utils/errors'
import { sleep } from './utils/utils'
import { name, version } from './version'

declare const ethereum: ExternalProvider

const ethereumRequest = async <T>(
  method: string,
  params: string[]
): Promise<T> => {
  // If ethereum.request() exists, the provider is probably EIP-1193 compliant.
  if (!ethereum?.request) {
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
    const response = await request<{ version: string }>(
      `https://registry.npmjs.org/${pkgName}/latest`,
      undefined,
      1,
      true
    )
    const latestVersion = response.version
    const currentVersion = packageVersion ?? version
    if (semverCompare(latestVersion, currentVersion)) {
      console.warn(
        // eslint-disable-next-line max-len
        `${pkgName}: new package version is available. Please update as soon as possible to enjoy the newest features. Current version: ${currentVersion}. Latest version: ${latestVersion}.`
      )
    }
  } catch (error) {
    // Cannot verify version, might be network error etc. We don't bother showing anything in that case
  }
}

/**
 * Converts a quote to Route
 * @param {Step} step - Step returned from the quote endpoint.
 * @return {Route} - The route to be executed.
 * @throws {ValidationError} Throws a ValidationError if the step has missing values.
 */

export const convertQuoteToRoute = (step: Step): Route => {
  if (!step.estimate.fromAmountUSD) {
    throw new ValidationError("Missing 'fromAmountUSD' in step estimate.")
  }

  if (!step.estimate.toAmountUSD) {
    throw new ValidationError("Missing 'toAmountUSD' in step estimate.")
  }

  const lifiStep: LifiStep = {
    ...step,
    type: 'lifi',
    includedSteps: [],
  }

  const route: Route = {
    fromToken: step.action.fromToken,
    toToken: step.action.toToken,
    fromAmount: step.action.fromAmount,
    toAmount: step.estimate.toAmount,
    id: step.id,
    fromChainId: step.action.fromToken.chainId,
    toChainId: step.action.toToken.chainId,
    fromAmountUSD: step.estimate.fromAmountUSD,
    toAmountUSD: step.estimate.toAmountUSD,
    steps: [lifiStep],
    toAmountMin: step.estimate.toAmountMin,
    insurance: { state: 'NOT_INSURABLE', feeAmountUsd: '0' },
  }

  return route
}

export const requestSettings = {
  retries: 1,
}

export const request = async <T = Response>(
  url: RequestInfo | URL,
  options?: RequestInit,
  retries = requestSettings.retries,
  skipTrackingHeaders = false
): Promise<T> => {
  const { userId, integrator, widgetVersion } =
    ConfigService.getInstance().getConfig()

  try {
    const updatedOptions: RequestInit = {
      ...(options ?? {}),
    }

    if (!skipTrackingHeaders) {
      if (userId) {
        updatedOptions.headers = {
          ...updatedOptions?.headers,
          'X-LIFI-UserId': userId,
        }
      }

      if (widgetVersion) {
        updatedOptions.headers = {
          ...updatedOptions?.headers,
          'X-LIFI-Widget': widgetVersion,
        }
      }

      if (version) {
        updatedOptions.headers = {
          ...updatedOptions?.headers,
          'X-LIFI-SDK': version,
        }
      }

      // integrator is mandatory during SDK initialization
      updatedOptions.headers = {
        ...updatedOptions?.headers,
        'X-LIFI-Integrator': integrator,
      }
    }

    const response: Response = await fetch(url, updatedOptions)
    if (!response.ok) {
      throw new HTTPError(response)
    }

    const data: T = await response.json()
    return data
  } catch (error) {
    if (retries > 0 && (error as HTTPError)?.status === 500) {
      await sleep(500)
      return request<T>(url, options, retries - 1)
    }
    throw error
  }
}
