import { executeRoute, getRoutes, getStepTransaction } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { isSkip, loadE2EEnv } from './env.js'
import { createE2EClient, observeRouteWrites } from './harness.js'
import { amountForUsd, TOKENS } from './tokens.js'

const SOL_CHAIN_ID = 1151111081099710
const env = loadE2EEnv()

if (isSkip(env)) {
  process.stderr.write(`\n  Solana E2E skipped: ${env.skip}\n`)
}

describe.skipIf(isSkip(env))('Solana E2E', () => {
  if (isSkip(env)) {
    return
  }

  describe.sequential('Phase 1: Jito bundle', () => {
    it('returns a bundle-shaped transactionRequest for PENGU->USD* with jitoBundle', async () => {
      // The premise the whole bundle path rests on: `jitoBundle: true` in
      // the ROUTES options (not a quote query param) yields a route whose
      // step carries a Perena leg, and stepTransaction then packs it into
      // an array. If this stops holding the phase must fail loudly rather
      // than silently exercise the standard path.
      const { client, address } = await createE2EClient(env)

      const { routes } = await getRoutes(client, {
        fromChainId: SOL_CHAIN_ID,
        toChainId: SOL_CHAIN_ID,
        fromTokenAddress: TOKENS.PENGU.mint,
        toTokenAddress: TOKENS.USDSTAR.mint,
        fromAmount: amountForUsd(TOKENS.PENGU, 0.25),
        fromAddress: address,
        toAddress: address,
        options: {
          integrator: 'lifi-sdk-e2e',
          order: 'CHEAPEST',
          maxPriceImpact: 0.4,
          jitoBundle: true,
        },
      })

      expect(routes.length).toBeGreaterThan(0)

      const step = routes[0].steps[0]
      const includedTools = (step.includedSteps ?? []).map(
        (included) => included.tool
      )
      expect(
        includedTools,
        `expected a Perena leg; got ${JSON.stringify(includedTools)}. ` +
          'Without it the backend returns a single transaction and the ' +
          'bundle path is not being tested.'
      ).toContain('perena')

      const withTx = await getStepTransaction(client, step)
      const data = withTx.transactionRequest?.data
      expect(
        Array.isArray(data),
        'transactionRequest.data must be an array - that is what ' +
          'SolanaSignAndExecuteTask switches on to choose sendBundle.'
      ).toBe(true)
      // Bound to a local first: reading `.length` straight off the optional
      // chain throws a TypeError when the payload is missing, which buries
      // the readable assertion above under a stack trace.
      expect(data as unknown as string[]).toHaveLength(2)
    }, 120_000)

    it.skipIf(!env.execute)(
      'executes the bundle and confirms it through the Jito path',
      async () => {
        const { client, address } = await createE2EClient(env)
        const { hook, observed } = observeRouteWrites()

        const { routes } = await getRoutes(client, {
          fromChainId: SOL_CHAIN_ID,
          toChainId: SOL_CHAIN_ID,
          fromTokenAddress: TOKENS.PENGU.mint,
          toTokenAddress: TOKENS.USDSTAR.mint,
          fromAmount: amountForUsd(TOKENS.PENGU, 0.25),
          fromAddress: address,
          toAddress: address,
          options: {
            integrator: 'lifi-sdk-e2e',
            order: 'CHEAPEST',
            maxPriceImpact: 0.4,
            jitoBundle: true,
          },
        })

        const executed = await executeRoute(client, routes[0], {
          updateRouteHook: hook,
        })

        const action = executed.steps[0].execution?.actions.at(-1)
        expect(action?.status).toBe('DONE')
        expect(action?.txHash).toBeDefined()
        expect(action?.txLink).toBeDefined()
        // txHash is written at signing; txLink only once an RPC accepted the
        // send. A link written first would point at a transaction that a
        // failed submission leaves nonexistent on chain.
        expect(observed.order[0]).toBe('txHash')
      },
      180_000
    )
  })
})
