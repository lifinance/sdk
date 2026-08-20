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
 * `jitoBundle` has to be set on the CLIENT, not only on the routes request:
 * `getStepTransaction` reads `config.routeOptions.jitoBundle` to decide
 * whether to append the query parameter, and the routes options never reach
 * it. A caller that sets it in one place only gets a route with a Perena leg
 * and a single transaction for it, which looks correct and tests nothing.
 */
export async function createE2EClient(
  env: E2EEnv,
  { jitoBundle = false }: { jitoBundle?: boolean } = {}
): Promise<{ client: SDKClient; address: string }> {
  const wallet = new KeypairWalletAdapter(env.privateKey)
  await wallet.connect()

  const client = createClient({
    integrator: 'lifi-sdk-e2e',
    rpcUrls: { [ChainId.SOL]: env.rpcUrls },
    // Both omitted unless set, so the client keeps its production defaults.
    // A full matrix run exhausts production's shared anonymous quota, which
    // surfaces as a 429 midway and leaves the run half-done.
    ...(env.apiUrl ? { apiUrl: env.apiUrl } : {}),
    ...(env.apiKey ? { apiKey: env.apiKey } : {}),
    // `getStepTransaction` builds its own URL and reads `jitoBundle` from
    // here, NOT from the options passed to `getRoutes`. Setting it only on
    // the routes request yields a route that carries a Perena leg and then a
    // single transaction for it - the request looks right and the payload
    // silently is not a bundle. Callers that want the standard path build
    // their own client with `jitoBundle` omitted.
    routeOptions: jitoBundle ? { jitoBundle: true } : undefined,
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
