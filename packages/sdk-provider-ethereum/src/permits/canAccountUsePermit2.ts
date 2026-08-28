import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAccountCode } from '../actions/getAccountCode.js'
import { acceptsRawEcdsaSignature } from './acceptsRawEcdsaSignature.js'

/**
 * Whether the account can produce a signature Uniswap Permit2 will accept.
 *
 * Permit2's `SignatureVerification.verify` branches on
 * `claimedSigner.code.length`: no code → `ecrecover`, which every EOA satisfies;
 * code → `owner.isValidSignature(...)`, so {@link acceptsRawEcdsaSignature}
 * probes it. Checking code length alone would exclude EIP-7702 accounts that
 * verify our signatures fine, costing those users a needless approval.
 *
 * `false` on RPC failure — approve + execute always works. Same for accounts
 * that *revert* on a signer mismatch (strict 7702 delegates, Sequence): they
 * would accept the real signature but fail the probe, and pay one exact-amount
 * approval per step instead.
 */
export const canAccountUsePermit2 = async (
  client: SDKClient,
  { chainId, address }: { chainId: number; address: Address }
): Promise<boolean> => {
  const code = await getAccountCode({ client, chainId, address })
  if (code === undefined) {
    return false
  }
  if (code === '0x') {
    return true
  }
  return acceptsRawEcdsaSignature(client, chainId, address)
}
