import {
  ChainId,
  createClient,
  type RouteExtended,
  type SDKClient,
  type UpdateRouteHook,
} from '@lifi/sdk'
import { SolanaProvider } from '../src/SolanaProvider.js'
import { KeypairWalletAdapter } from '../src/utils/KeypairWalletAdapter.js'
import type { E2EEnv } from './env.js'

/**
 * For `ChainId.SOL` the supplied URLs replace the LI.FI defaults rather than
 * merging - the configuration a bundle integrator must use.
 *
 * `jitoBundle` must be set on the CLIENT: `getStepTransaction` reads it from
 * `config.routeOptions`, and the routes options never reach it. Setting it in
 * one place only yields a Perena route and a single transaction for it, which
 * looks correct and tests nothing.
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
    // Omitted unless set; production's shared quota runs out mid-matrix.
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
 * Records when `txHash` and `txLink` first appear. The order is the assertion
 * that matters - checking only the final state cannot tell the deferred design
 * from one that writes both at signing.
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
