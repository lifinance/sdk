import type { SDKClient } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { getAccountCode } from '../actions/getAccountCode.js'
import { acceptsRawEcdsaSignature } from './acceptsRawEcdsaSignature.js'

/**
 * Whether the account can produce a signature an EIP-2612 `permit` will accept.
 *
 * Signing ECDSA is not the question — verification is. Tokens whose `permit`
 * routes through a `SignatureChecker` branch on `owner.code.length` exactly as
 * Permit2 does, so an owner with code takes the EIP-1271 path where strict
 * delegates reject a bare signature (Circle's `FiatTokenV2_2`, i.e. USDC), hence
 * the {@link acceptsRawEcdsaSignature} probe. The probe describes the account
 * while the verifier lives in the token, so a strict delegate spending a
 * plain-`ecrecover` token is refused a permit it could have used — an approval
 * rather than a revert, and the token's path is not reliably introspectable.
 * `false` on a missing chain id, a missing account, or RPC failure.
 */
export const canAccountUseNativePermits = async (
  client: SDKClient,
  viemClient: Client
): Promise<boolean> => {
  const chainId = viemClient.chain?.id
  const address = viemClient.account?.address as Address | undefined
  if (chainId === undefined || address === undefined) {
    return false
  }
  const code = await getAccountCode({ client, chainId, address })
  // `undefined` means the lookup failed, not "no code" — `getAccountCode`
  // normalizes an empty result to `'0x'` precisely so these stay distinct.
  if (code === undefined) {
    return false
  }
  if (code === '0x') {
    return true
  }
  return acceptsRawEcdsaSignature(client, chainId, address)
}
