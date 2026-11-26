import {
  executeRoute,
  LiFiErrorCode,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  openPage,
  quotedCallOf,
  recordRoute,
} from './harness.mock.js'

let network: FakeTronNetwork

beforeEach(() => {
  network = installFakeTronNetwork()
})

afterEach(() => {
  const unknown = [...network.unknown]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // A request no fake implements turns into an RPC error and can let a path
  // pass for the wrong reason.
  expect(unknown, 'requests no fake implements').toEqual([])
})

/**
 * A two-step route. The first step's `/status` answer reports `received` as
 * the amount that arrived; the second step was quoted for 1 TRX and carries
 * the quoted transaction request.
 */
const buildTwoStepRoute = (
  received: string
): { route: Route; second: LiFiStepExtended } => {
  const first = buildStep('trx-swap')
  // The harness answers `/status` from the quoted step object.
  first.estimate.toAmount = received
  const second = buildStep('trx-swap')
  const route = buildRoute(first)
  route.steps.push(second)
  return { route, second }
}

/** The `call_value` and call data of the last transaction the wallet saw. */
const lastSigned = (
  requests: { raw_data: { contract: { parameter: { value: unknown } }[] } }[]
): { call_value: number; data: string } =>
  requests.at(-1)!.raw_data.contract[0].parameter.value as {
    call_value: number
    data: string
  }

describe('Tron later step', () => {
  it('quotes the amount that arrived and signs the fresh quote, not the quoted request', async () => {
    const page = openPage()
    const { route, second } = buildTwoStepRoute('950000')

    const executed = await executeRoute(page.client, route)

    expect(network.requotes).toHaveLength(1)
    expect(network.requotes[0].action.fromAmount).toBe('950000')
    const signed = lastSigned(page.wallet.requests)
    expect(signed.call_value).toBe(950_000)
    expect(signed.data).toBe(
      quotedCallOf(
        network.requotes[0].transactionRequest?.data
      ).data.toUpperCase()
    )
    expect(signed.data).not.toBe(
      quotedCallOf(second.transactionRequest?.data).data.toUpperCase()
    )
    expect(executed.steps.map((step) => step.execution?.status)).toEqual([
      'DONE',
      'DONE',
    ])
  })

  // `executeRoute` on a stored route runs no `prepareRestart`. The stored
  // second step carries the request of the earlier run, for the same amount.
  it('quotes again when executeRoute runs a stored route whose later step carries an earlier request', async () => {
    const page = openPage()
    const { route } = buildTwoStepRoute('1000000')
    const recorder = recordRoute()
    // The first step signs; the second step's signature is rejected.
    const sign = page.wallet.adapter.signTransaction.bind(page.wallet.adapter)
    let signs = 0
    vi.spyOn(page.wallet.adapter, 'signTransaction').mockImplementation(
      async (transaction) => {
        signs += 1
        if (signs === 2) {
          page.wallet.rejectNext()
        }
        return sign(transaction)
      }
    )

    await expect(
      executeRoute(page.client, route, {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    const stored = recorder.last()
    const storedRequest = stored.steps[1].transactionRequest?.data
    expect(storedRequest).toBeDefined()
    const requotesBefore = network.requotes.length

    const executed = await executeRoute(page.client, stored)

    expect(network.requotes).toHaveLength(requotesBefore + 1)
    const fresh = network.requotes.at(-1)!
    expect(fresh.action.fromAmount).toBe('1000000')
    const signed = lastSigned(page.wallet.requests)
    expect(signed.data).toBe(
      quotedCallOf(fresh.transactionRequest?.data).data.toUpperCase()
    )
    expect(signed.data).not.toBe(quotedCallOf(storedRequest).data.toUpperCase())
    expect(executed.steps[1].execution?.status).toBe('DONE')
  })

  // The request is dropped also on a later step whose transaction is open.
  // That step resumes at the wait and must not quote or sign again.
  it('waits for the open transaction of a later step after the request is dropped', async () => {
    const page = openPage()
    const { route } = buildTwoStepRoute('950000')
    const recorder = recordRoute()
    await executeRoute(page.client, route, {
      updateRouteHook: recorder.updateRouteHook,
    })
    // The stored route right after the second step's broadcast: the action
    // has its hash, and the signed bytes are gone.
    const open = recorder.snapshots.find((snapshot) => {
      const swap = snapshot.steps[1].execution?.actions.find(
        (action) => action.type === 'SWAP'
      )
      return swap?.status === 'PENDING' && swap.txHash && !swap.txHex
    })
    expect(open).toBeDefined()
    const reloaded = JSON.parse(JSON.stringify(open)) as RouteExtended
    expect(reloaded.steps[1].transactionRequest).toBeDefined()
    const requotes = network.requotes.length
    const broadcasts = network.broadcasts.length
    const reloadedPage = openPage()

    const executed = await executeRoute(reloadedPage.client, reloaded)

    expect(reloadedPage.wallet.requests).toEqual([])
    expect(network.requotes).toHaveLength(requotes)
    expect(network.broadcasts).toHaveLength(broadcasts)
    expect(executed.steps[1].execution?.status).toBe('DONE')
  })
})
