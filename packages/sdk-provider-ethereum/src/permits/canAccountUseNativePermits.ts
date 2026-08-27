import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAccountCode } from '../actions/getAccountCode.js'
import { acceptsRawEcdsaSignature } from './acceptsRawEcdsaSignature.js'
import { isDelegationDesignatorCode } from './isDelegationDesignatorCode.js'

/**
 * Whether the account can produce a signature an EIP-2612 `permit` will accept.
 *
 * Signing ECDSA is not the question — verification is. Tokens whose `permit`
 * routes through a `SignatureChecker` branch on `owner.code.length` exactly as
 * Permit2 does, so an owner with code takes the EIP-1271 path where strict
 * delegates reject a bare signature (Circle's `FiatTokenV2_2`, i.e. USDC), hence
 * the {@link acceptsRawEcdsaSignature} probe for EIP-7702 delegates.
 *
 * Other contract accounts stay blocked on shape alone and are never probed.
 * `encodeNativePermitData` splits the signature with `parseSignature`, so this
 * path needs 65 ECDSA bytes — which a 7702 delegate signing with its root key
 * always produces, and a contract wallet generally does not. Probing them would
 * admit any implementation that *returns* a failure value rather than reverting,
 * skip the approval, then throw after the user had already signed.
 *
 * The probe describes the account while the verifier lives in the token, so a
 * strict delegate spending a plain-`ecrecover` token is refused a permit it
 * could have used — an approval rather than a revert, and the token's path is
 * not reliably introspectable. `false` on RPC failure.
 *
 * Takes the chain and owner explicitly, mirroring {@link canAccountUsePermit2}:
 * reading them off a wallet client silently reported "no native permit" for
 * every caller that falls back to a public client.
 */
export const canAccountUseNativePermits = async (
  client: SDKClient,
  { chainId, address }: { chainId: number; address: Address }
): Promise<boolean> => {
  const code = await getAccountCode({ client, chainId, address })
  // `undefined` means the lookup failed, not "no code" — `getAccountCode`
  // normalizes an empty result to `'0x'` precisely so these stay distinct.
  if (code === undefined) {
    return false
  }
  if (code === '0x') {
    return true
  }
  // Shape first: only 7702 delegates reach the probe. See the note above on
  // `parseSignature` — deliberately narrower than the Permit2 gate.
  if (!isDelegationDesignatorCode(code)) {
    return false
  }
  return acceptsRawEcdsaSignature(client, chainId, address)
}
