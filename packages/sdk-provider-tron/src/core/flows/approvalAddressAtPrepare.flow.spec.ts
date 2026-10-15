import { executeRoute, type LiFiStep } from '@lifi/sdk'
import { TronWeb } from 'tronweb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  openPage,
  recordRoute,
  USDT,
  WALLET_ADDRESS,
} from './harness.mock.js'

/** The spender `/stepTransaction` answers with (e.g. Relay's depository). */
const EXECUTION_SPENDER: string = TronWeb.address.fromHex(
  `41${'44'.repeat(20)}`
)

let network: FakeTronNetwork

beforeEach(() => {
  network = installFakeTronNetwork()
})

afterEach(() => {
  const unknown = [...network.unknown]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(unknown, 'requests no fake implements').toEqual([])
})

/** `/stepTransaction` sets the spender, as Relay's executable quote can. */
const setSpender = (step: LiFiStep): LiFiStep => ({
  ...step,
  estimate: { ...step.estimate, approvalAddress: EXECUTION_SPENDER },
})

/** A routing-time TRC-20 step with no spender and no transaction yet. */
const buildIndicativeRoute = () => {
  const step = buildStep('trc20-swap')
  step.estimate.approvalAddress = ''
  delete step.transactionRequest
  return buildRoute(step)
}

const allowanceReads = (): string[] =>
  network.nodeCalls.filter((call) => call.includes('allowance'))

describe('Tron: the spender appears at /stepTransaction', () => {
  it('approves it before the swap when it holds no allowance', async () => {
    network.onStepTransaction = setSpender
    const page = openPage()
    const recorder = recordRoute()

    const route = await executeRoute(page.client, buildIndicativeRoute(), {
      updateRouteHook: recorder.updateRouteHook,
    })

    expect(page.wallet.signed).toHaveLength(2)
    expect(
      network.allowance(USDT.address, WALLET_ADDRESS, EXECUTION_SPENDER)
    ).toBe(2_000_000n)
    expect(allowanceReads()).toHaveLength(1)
    expect(recorder.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(route.steps[0].execution?.status).toBe('DONE')
  })

  it('sends no approval when its allowance suffices', async () => {
    network.onStepTransaction = setSpender
    network.setAllowance(
      USDT.address,
      WALLET_ADDRESS,
      EXECUTION_SPENDER,
      2_000_000n
    )
    const page = openPage()

    const route = await executeRoute(page.client, buildIndicativeRoute())

    expect(page.wallet.signed).toHaveLength(1)
    expect(allowanceReads()).toHaveLength(1)
    expect(route.steps[0].execution?.status).toBe('DONE')
  })

  it('leaves the allowance alone when the re-quote brings no spender either', async () => {
    const page = openPage()

    const route = await executeRoute(page.client, buildIndicativeRoute())

    expect(page.wallet.signed).toHaveLength(1)
    expect(allowanceReads()).toEqual([])
    expect(route.steps[0].execution?.status).toBe('DONE')
  })
})
