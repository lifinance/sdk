import {
  ChainId,
  createClient,
  type RouteExtended,
  type SDKClient,
  type UpdateRouteHook,
} from '@lifi/sdk'
import { SolanaProvider } from '../SolanaProvider.js'
import { KeypairWalletAdapter } from '../utils/KeypairWalletAdapter.js'
import type { E2EEnv } from './env.js'

/**
 * Builds a client wired to the supplied RPCs and a keypair wallet.
 *
 * For `ChainId.SOL` the supplied URLs REPLACE the LI.FI defaults rather than
 * merging with them (`getClientStorage` passes `[ChainId.SOL]` as
 * `skipChains`). That is exactly the configuration a bundle integrator must
 * use, and it is what puts a Jito-capable endpoint into the pool.
 *
 * `jitoBundle` is deliberately not set here. Each phase sets it per request,
 * because one route object has to be able to drive both submission paths.
 */
export async function createE2EClient(
  env: E2EEnv
): Promise<{ client: SDKClient; address: string }> {
  const wallet = new KeypairWalletAdapter(env.privateKey)
  await wallet.connect()

  const client = createClient({
    integrator: 'lifi-sdk-e2e',
    rpcUrls: { [ChainId.SOL]: env.rpcUrls },
  })

  client.setProviders([SolanaProvider({ getWallet: async () => wallet })])

  const address = wallet.accounts[0]?.address
  if (!address) {
    throw new Error('Keypair wallet exposed no account after connect()')
  }

  return { client, address }
}

/** When each field was first observed, and in what order. */
export type ObservedWrites = {
  txHashAt: number | undefined
  txLinkAt: number | undefined
  order: string[]
}

/**
 * An `updateRouteHook` that records when `txHash` and `txLink` first appear.
 *
 * The order is the assertion that matters. PR #448 writes `txHash` at signing
 * time and defers `txLink` until an RPC accepts the send, because a link
 * recorded at signing would 404 for a transaction that is never broadcast.
 * Checking only the final state cannot tell the two designs apart.
 *
 * It records what happened rather than what should have, so a regression that
 * reverses the order is visible instead of being asserted away.
 */
export function observeRouteWrites(): {
  hook: UpdateRouteHook
  observed: ObservedWrites
} {
  const observed: ObservedWrites = {
    txHashAt: undefined,
    txLinkAt: undefined,
    order: [],
  }

  const hook: UpdateRouteHook = (route: RouteExtended) => {
    for (const step of route.steps) {
      for (const action of step.execution?.actions ?? []) {
        if (action.txHash && observed.txHashAt === undefined) {
          observed.txHashAt = Date.now()
          observed.order.push('txHash')
        }
        if (action.txLink && observed.txLinkAt === undefined) {
          observed.txLinkAt = Date.now()
          observed.order.push('txLink')
        }
      }
    }
  }

  return { hook, observed }
}
