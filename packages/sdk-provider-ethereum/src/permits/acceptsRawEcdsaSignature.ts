import type { SDKClient } from '@lifi/sdk'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { call } from 'viem/actions'
import { getAction } from 'viem/utils'
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
 * Asks an account with code whether it evaluates a plain 65-byte ECDSA
 * signature: a return means it recovered a signer and merely found a mismatch,
 * so the real root-key signature will verify, while a revert means it rejected
 * the envelope and nothing we produce will. Keyed on revert-vs-return, never on
 * the value — the probe signature recovers to a third party on purpose, so a
 * correct implementation returns a *non*-magic value, and comparing against the
 * magic value would reject every wallet this exists to accept. Only call it for
 * accounts that have code; a code-less address returns empty data and would read
 * as incapable.
 */
export const acceptsRawEcdsaSignature = async (
  client: SDKClient,
  chainId: number,
  address: Address
): Promise<boolean> => {
  try {
    const publicClient = await getPublicClient(client, chainId)
    const { data } = await getAction(
      // CCIP-Read off, or an `OffchainLookup` revert comes back as a return and
      // inverts the signal read below. viem gates it on the client, not the
      // call, so clone rather than disable it on the shared ENS-using client.
      // Relies on `getPublicClient` staying bare: add `publicActions` and
      // `getAction` prefers a decorated `client.call`, re-enabling CCIP-Read.
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
    // A full 32-byte word (`0x` + 64 chars) or nothing: verifiers compare against
    // a magic value, so anything shorter can only be a false positive.
    return !!data && data.length >= 66
  } catch {
    // Revert, or an RPC failure we can't tell apart from one. Either way we
    // must not promise the signature will verify.
    return false
  }
}
