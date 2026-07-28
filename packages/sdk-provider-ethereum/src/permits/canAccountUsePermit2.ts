import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAccountCode } from '../actions/getAccountCode.js'

/**
 * Whether the account can use Uniswap Permit2 — true **only** for accounts
 * with no on-chain code.
 *
 * Deliberately stricter than `canAccountUseNativePermits`, which also allows
 * EIP-7702 delegated EOAs. The two verify signatures differently:
 *
 * - EIP-2612 `permit()` recovers the signer with `ecrecover` and compares it
 *   to `owner`, so a 7702 delegated EOA's plain ECDSA signature is accepted.
 * - Permit2's `SignatureVerification.verify` branches on
 *   `claimedSigner.code.length`. A 7702 delegation designator is code, so it
 *   takes the **EIP-1271** path and calls `owner.isValidSignature(...)`
 *   instead of `ecrecover`. Delegate implementations (e.g. Alchemy's
 *   ERC-6900 `SemiModularAccount7702`) reject a bare 65-byte ECDSA signature
 *   and revert, so the transaction fails before the LI.FI diamond is reached.
 *
 * Returns `false` on RPC failure ("if unsure, don't use Permit2") — the
 * fallback is a standard approve + execute, which costs an extra approval but
 * always works.
 */
export const canAccountUsePermit2 = async (
  client: SDKClient,
  { chainId, address }: { chainId: number; address: Address }
): Promise<boolean> => {
  const code = await getAccountCode({ client, chainId, address })
  return code === '0x'
}
