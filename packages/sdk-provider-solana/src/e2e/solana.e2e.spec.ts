import { executeRoute, getRoutes, getStepTransaction } from '@lifi/sdk'
import { afterAll, describe, expect, it } from 'vitest'
import { isSkip, loadE2EEnv } from './env.js'
import { createE2EClient, observeRouteWrites } from './harness.js'
import { formatReport, type LegResult } from './report.js'
import { amountForUsd, planStandardMatrix, TOKENS } from './tokens.js'

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
      const { client, address } = await createE2EClient(env, {
        jitoBundle: true,
      })

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
        const { client, address } = await createE2EClient(env, {
          jitoBundle: true,
        })
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

  describe.sequential('Phase 2: same pair, standard path', () => {
    it('returns a single transaction when jitoBundle is omitted', async () => {
      // One route object drives both paths. Proving the standard shape on
      // the SAME pair rules out "PENGU just never bundles" as the reason
      // Phase 1 saw an array.
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
        },
      })

      expect(routes.length).toBeGreaterThan(0)
      const withTx = await getStepTransaction(client, routes[0].steps[0])
      expect(typeof withTx.transactionRequest?.data).toBe('string')
    }, 120_000)
  })

  describe.sequential('Phase 3: standard matrix', () => {
    const legs = planStandardMatrix(0.25)
    const results: LegResult[] = []

    afterAll(() => {
      if (results.length > 0) {
        process.stderr.write(formatReport(results))
      }
    })

    for (const leg of legs) {
      const label = `${leg.from.symbol}->${leg.to.symbol}`

      it.skipIf(!env.execute)(
        `swaps ${label}`,
        async () => {
          // Legs run sequentially: each spends what the previous produced,
          // and concurrent swaps from one wallet race for the same token
          // accounts.
          const started = Date.now()
          const { client, address } = await createE2EClient(env)

          let routes: Awaited<ReturnType<typeof getRoutes>>['routes']
          try {
            const response = await getRoutes(client, {
              fromChainId: SOL_CHAIN_ID,
              toChainId: SOL_CHAIN_ID,
              fromTokenAddress: leg.from.mint,
              toTokenAddress: leg.to.mint,
              fromAmount: leg.fromAmount,
              fromAddress: address,
              toAddress: address,
              options: { integrator: 'lifi-sdk-e2e' },
            })
            routes = response.routes
          } catch (error) {
            // No route, or below a minimum, is an environment fact about a
            // $0.25 leg rather than an SDK defect. Recorded and skipped, so
            // the report never shows a green matrix that mostly did not run.
            results.push({
              label,
              outcome: 'skip',
              reason: `route request failed: ${(error as Error).message}`,
            })
            return
          }

          if (!routes.length) {
            results.push({ label, outcome: 'skip', reason: 'no route offered' })
            return
          }

          try {
            const executed = await executeRoute(client, routes[0])
            const action = executed.steps[0].execution?.actions.at(-1)
            expect(action?.status).toBe('DONE')
            results.push({
              label,
              outcome: 'pass',
              durationMs: Date.now() - started,
              signature: action?.txHash,
            })
          } catch (error) {
            results.push({
              label,
              outcome: 'fail',
              reason: (error as Error).message,
              durationMs: Date.now() - started,
            })
            throw error
          }
        },
        180_000
      )
    }
  })
})
