import { type SDKClient, withDedupe } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { getCode } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getPublicClient } from '../client/publicClient.js'

type GetAccountCodeParams = {
  client: SDKClient
  chainId: number
  address: Address
}

/**
 * Shared `eth_getCode` fetcher. Deliberately uncached across executions so
 * a wallet re-delegate / upgrade / un-delegate in another tab is never
 * served stale; `withDedupe` only collapses concurrent in-flight callers.
 *
 * Always queries the SDK's per-chain public client (never the wallet
 * client) so cross-chain steps and post-chain-switch flows read from the
 * chain the step actually executes on.
 *
 * Returns `'0x'` for an account with no code and `undefined` *only* on RPC
 * failure. Each caller MUST classify the failure case explicitly (e.g.
 * "treat as EOA" vs. "treat as not-permittable") — there is no single safe
 * default.
 *
 * The `?? '0x'` is load-bearing: viem's `getCode` normalizes empty code to
 * `undefined`, which would otherwise make a plain EOA indistinguishable from
 * a failed RPC and silently push every EOA down the failure path.
 */
export const getAccountCode = ({
  client,
  chainId,
  address,
}: GetAccountCodeParams): Promise<Hex | undefined> =>
  withDedupe(
    async () => {
      try {
        const publicClient = await getPublicClient(client, chainId)
        const code = await getAction(
          publicClient,
          getCode,
          'getCode'
        )({ address })
        return code ?? '0x'
      } catch {
        return undefined
      }
    },
    { id: `getAccountCode:${chainId}:${address.toLowerCase()}` }
  )
