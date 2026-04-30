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
 * Returns `undefined` on RPC failure. Each caller MUST classify that
 * explicitly (e.g. "treat as EOA" vs. "treat as not-permittable") — there
 * is no single safe default.
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
        return await getAction(publicClient, getCode, 'getCode')({ address })
      } catch {
        return undefined
      }
    },
    { id: `getAccountCode:${chainId}:${address.toLowerCase()}` }
  )
