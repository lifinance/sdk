import type { LiFiStep } from '@lifi/sdk'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP on a
    // 5s interval and never settles under test. It runs after everything these
    // specs assert on; the rest of the pipeline stays real.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (): Promise<{ status: 'COMPLETED' }> => ({
        status: 'COMPLETED',
      })
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import {
  APPROVAL_ADDRESS,
  buildPermitTypedData,
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  createScenario,
  LIFI_PERMIT2_PROXY,
  PROTOCOL_CONTRACT,
  type Scenario,
  type ScenarioOptions,
  WALLET_SIGNATURE,
} from './harness.mock.js'

const ORDER_TYPED_DATA = buildTypedData({
  primaryType: 'Order',
  domain: { name: 'LiFiOrder', chainId: 137 },
  message: { maker: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', salt: '1' },
})

const SUFFICIENT_ALLOWANCE = 10n ** 24n

/**
 * The order flow: an EIP-2612 permit whose spender is a protocol contract —
 * neither canonical Permit2 nor the Permit2Proxy — and a re-quote that answers
 * with the order to sign.
 */
const buildOrderScenario = (
  onSignTypedData?: ScenarioOptions['onSignTypedData']
): Scenario =>
  createScenario({
    step: buildStep({
      typedData: [buildPermitTypedData(PROTOCOL_CONTRACT)],
    }),
    allowance: SUFFICIENT_ALLOWANCE,
    onStepTransaction: (step: LiFiStep) => ({
      ...step,
      typedData: [ORDER_TYPED_DATA],
    }),
    onSignTypedData,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C3 — order flow picks the /quote endpoint, never the relayer quote', () => {
  it('signs the permit, re-quotes through getStepTransaction, then signs and relays the order', async () => {
    const scenario = buildOrderScenario()

    await scenario.run()

    // The endpoint choice is the assertion that matters most here: an order
    // flow is a relayer step (`isRelayerStep` is true for any typed data), but
    // `getUpdatedStep` only reaches `getRelayerQuote` for a *gasless* step, and
    // an EIP-2612 permit is not one.
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    expect(scenario.events('getRelayerQuote')).toEqual([])

    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['Permit', 'Order'])

    // The permit authorises the protocol contract. Pinning the spender guards
    // against the Permit2 / Permit2Proxy conflation this codebase is prone to:
    // neither address appears anywhere in this flow.
    const [permitSignature] = scenario.events('signTypedData')
    expect(permitSignature.message.spender).toBe(PROTOCOL_CONTRACT)

    const [relayed] = scenario.events('relayTransaction')
    expect(
      relayed.typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['Permit', WALLET_SIGNATURE],
      ['Order', WALLET_SIGNATURE],
    ])
  })

  it('still uses getStepTransaction on the retry after the user rejects the order', async () => {
    let orderRejected = false
    const scenario = buildOrderScenario(async (request): Promise<Hex> => {
      if (request.primaryType === 'Order' && !orderRejected) {
        orderRejected = true
        const rejection = new Error('User rejected the request.')
        rejection.name = 'UserRejectedRequestError'
        throw rejection
      }
      return WALLET_SIGNATURE
    })

    const error = await scenario.runExpectingFailure()
    expect(error.message).toContain('User rejected')
    expect(scenario.events('relayTransaction')).toEqual([])

    const retryStartsAt = scenario.timeline.length
    await scenario.retry()

    // The headline assertion, on the retry as well as the first attempt.
    expect(scenario.events('getStepTransaction', retryStartsAt)).toHaveLength(1)
    expect(scenario.events('getRelayerQuote')).toEqual([])
    expect(scenario.events('relayTransaction', retryStartsAt)).toHaveLength(1)

    // Pinned, and it looks wrong: `prepareRestart` clears the execution actions
    // and the transaction request, but NOT `step.typedData` — which attempt 1
    // replaced with the order. So on the retry the permits task no longer has a
    // `Permit` to sign, the signed permit from attempt 1 is gone with the
    // discarded context, and the pipeline falls through to the allowance path
    // instead. The order is the only thing signed and the permit is never
    // re-obtained, yet it was still needed for the relayer to pull the funds.
    expect(
      scenario
        .events('signTypedData', retryStartsAt)
        .map((event) => event.primaryType)
    ).toEqual(['Order'])
    expect(
      scenario
        .events('readContract', retryStartsAt)
        .map((event) => event.functionName)
    ).toEqual(['allowance'])

    // The allowance the retry reads is against canonical Permit2 — not the
    // Permit2Proxy and not the diamond: `resolvePermit2Support` answers `true`
    // for a relayed strategy without probing the signer.
    const [allowanceRead] = scenario.events('readContract', retryStartsAt)
    expect(allowanceRead.args[1]).toBe(CANONICAL_PERMIT2)
    expect(allowanceRead.args[1]).not.toBe(LIFI_PERMIT2_PROXY)
    expect(allowanceRead.args[1]).not.toBe(APPROVAL_ADDRESS)
  })
})
