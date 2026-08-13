import type { SDKClient } from '@lifi/sdk'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { call } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getAccountCode } from '../actions/getAccountCode.js'
import { getPublicClient } from '../client/publicClient.js'

const ERC1271_ABI = [
  {
    name: 'isValidSignature',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes' }],
    outputs: [{ type: 'bytes4' }],
  },
] as const

/**
 * A real 65-byte signature over {@link PROBE_HASH} from the public key `0x01…01`,
 * recovering to a third party — never the account under test. Throwaway probe
 * value, not a credential.
 *
 * MUST stay recoverable. An unrecoverable signature makes implementations that
 * revert (rather than return a failure value) look like they rejected the
 * envelope, misclassifying accounts that would have accepted ours.
 */
const PROBE_HASH = `0x${'ab'.repeat(32)}` as Hex
const PROBE_SIGNATURE =
  '0x997c61aa10e2330c076d6ba7abca1e71703a8f039291db103a62e085c9b2cf0d3f7e31ec9028229acc83093fbb722fa700fd6e4ea15d584df1bf384eb0051e0d1c' as Hex

/**
 * Asks a code-bearing account the same question Permit2 will: does it evaluate a
 * plain 65-byte ECDSA signature, or reject it outright?
 *
 * - **Returns** → it recovered a signer and found a mismatch, so it will accept
 *   the real root-key signature (MetaMask's `EIP7702StatelessDeleGator`).
 * - **Reverts** → it rejected the envelope before recovery and can't validate
 *   anything we produce (Alchemy's ERC-6900 `SemiModularAccount7702`).
 *
 * Keyed on revert-vs-return, not on revert data: the same ERC-6900 account
 * reverts with `ValidationSignatureSegmentMissing()` for a malformed signature
 * but with no data for a well-formed one. An empty return counts as unusable —
 * it fails Permit2's magic-value comparison too.
 *
 * Accepted limit: an implementation that returns the failure value for *every*
 * signature is indistinguishable from one that would accept ours, so it is
 * classified capable here and still fails on-chain. Return-vs-revert is the only
 * signal available — the probe signature recovers to a third party on purpose,
 * so a correct implementation must return a non-magic value, and comparing
 * against the magic value would reject every wallet this probe exists to
 * accept. Only verifying the real signature after signing closes that gap.
 */
const acceptsRawEcdsaSignature = async (
  client: SDKClient,
  chainId: number,
  address: Address
): Promise<boolean> => {
  try {
    const publicClient = await getPublicClient(client, chainId)
    const { data } = await getAction(
      // Never follow an `OffchainLookup` revert. Following it would send an
      // outbound request to a URL this contract chose, and would hand back a
      // return where the account actually reverted — inverting the one signal
      // read below. viem gates CCIP-Read on the client rather than on the call,
      // so the probe runs on a copy with it disabled; the shared public client
      // still needs CCIP for ENS.
      //
      // NOTE: this works because `getPublicClient` returns a bare `createClient`
      // with no `publicActions`, so `getAction` falls through to the `call`
      // imported here. If that client is ever extended with `publicActions`,
      // `getAction` would prefer its decorated `client.call`, which closes over
      // the original client and would silently re-enable CCIP-Read.
      { ...publicClient, ccipRead: false },
      call,
      'call'
    )({
      to: address,
      data: encodeFunctionData({
        abi: ERC1271_ABI,
        functionName: 'isValidSignature',
        args: [PROBE_HASH, PROBE_SIGNATURE],
      }),
    })
    // A full 32-byte word or nothing (`0x` + 64 hex characters = 66). Permit2
    // compares the return against its magic value, so anything shorter can
    // never satisfy it on-chain and would only be a false positive here.
    return !!data && data.length >= 66
  } catch {
    // Revert, or an RPC failure we can't tell apart from one. Either way we
    // must not promise Permit2 will work.
    return false
  }
}

/**
 * Whether the account can produce a signature Uniswap Permit2 will accept.
 *
 * Permit2's `SignatureVerification.verify` branches on
 * `claimedSigner.code.length`: no code → `ecrecover`, which every EOA satisfies
 * (and costs no extra RPC here); code → `owner.isValidSignature(...)`, whose
 * outcome depends on the implementation, so {@link acceptsRawEcdsaSignature}
 * tests it rather than guessing. Checking code length alone would exclude
 * EIP-7702 accounts that verify our signatures fine, costing those users a
 * needless approval.
 *
 * `false` on RPC failure — the approve + execute fallback always works.
 *
 * Accepted downgrade: an implementation that *reverts* on a signer mismatch
 * (`require(recovered == owner)` 7702 delegates, Sequence contract signatures)
 * fails the probe although it would accept the real signature. Those accounts
 * pay one exact-amount approval per step instead of using Permit2 — a gas cost
 * on a route that works, not a failure.
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
