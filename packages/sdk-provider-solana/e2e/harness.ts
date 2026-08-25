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

/** Which hook call first carried each field, and the resulting order.
 * `['together']` means one call carried both. */
export type ObservedWrites = {
  txHashAt: number | undefined
  txLinkAt: number | undefined
  order: string[]
}

/**
 * Records which `updateAction` call first carried each field.
 *
 * Counting hook invocations, not source order: both fields can appear in one
 * snapshot, and a hook that tests `txHash` before `txLink` would then always
 * report `['txHash','txLink']` - including for the design that writes both at
 * signing, which is the regression this exists to catch.
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
  let call = 0

  const hook: UpdateRouteHook = (route: RouteExtended) => {
    call += 1
    for (const step of route.steps) {
      for (const action of step.execution?.actions ?? []) {
        if (action.txHash && observed.txHashAt === undefined) {
          observed.txHashAt = call
        }
        if (action.txLink && observed.txLinkAt === undefined) {
          observed.txLinkAt = call
        }
      }
    }
    // Rebuilt from the recorded call numbers, so a tie is reported as a tie
    // rather than resolved by the order of the two branches above.
    observed.order =
      observed.txHashAt === undefined || observed.txLinkAt === undefined
        ? observed.order
        : observed.txHashAt === observed.txLinkAt
          ? ['together']
          : observed.txHashAt < observed.txLinkAt
            ? ['txHash', 'txLink']
            : ['txLink', 'txHash']
  }

  return { hook, observed }
}
