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

import type { LiFiStep, SignedTypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import {
  buildPermitTypedData,
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  decodeApproval,
  FROM_ADDRESS,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
  type ScenarioOptions,
  WALLET_SIGNATURE,
} from './harness.mock.js'

/** CoW's GPv2VaultRelayer. Checksummed, because the approve ABI-encodes it. */
const ORDER_SPENDER: Address = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

const ORDER_TYPED_DATA = buildTypedData({
  primaryType: 'Order',
  domain: { name: 'Gnosis Protocol', chainId: CHAIN_ID },
  message: { sellToken: FROM_TOKEN_ADDRESS, receiver: FROM_ADDRESS },
})

/**
 * A limit order with a permit to the protocol's own contract, as the Jumper
 * limit-order backend builds it for CoW and 1inch (JUMEMB-121).
 */
const buildProtocolPermitScenario = (
  options: Pick<ScenarioOptions, 'onSignTypedData'> & {
    onPosted?: (typedData: LiFiStep['typedData']) => void
  } = {}
): Scenario =>
  createScenario({
    step: buildStep({
      type: 'lifi',
      tool: 'cowswap',
      typedData: [buildPermitTypedData(ORDER_SPENDER)],
      approvalAddress: ORDER_SPENDER,
      skipPermit: true,
      executionType: 'message',
    }),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: (step: LiFiStep) => {
      options.onPosted?.(step.typedData)
      const { transactionRequest: _dropped, ...rest } = step
      return { ...rest, typedData: [ORDER_TYPED_DATA] }
    },
    onSignTypedData: options.onSignTypedData,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C16 — an order with a permit to the protocol’s own spender', () => {
  it('signs the permit, posts it to /stepTransaction, then signs and relays the order', async () => {
    const posted: LiFiStep['typedData'][] = []
    const scenario = buildProtocolPermitScenario({
      onPosted: (typedData) => posted.push(typedData),
    })

    await scenario.run()

    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['Permit', 'Order'])
    expect(scenario.events('signTypedData')[0].message.spender).toBe(
      ORDER_SPENDER
    )

    // The backend builds the CoW pre-hook from this signed permit.
    expect(posted).toHaveLength(1)
    expect(
      (posted[0] as SignedTypedData[]).map((entry) => [
        entry.primaryType,
        entry.signature,
      ])
    ).toEqual([['Permit', WALLET_SIGNATURE]])

    // Relayed in signing order, so the backend must pick the Order by type.
    const [relayed] = scenario.events('relayTransaction')
    expect(
      relayed.typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['Permit', WALLET_SIGNATURE],
      ['Order', WALLET_SIGNATURE],
    ])

    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
    expect(
      scenario
        .events('readContract')
        .filter((event) => event.functionName === 'allowance')
    ).toEqual([])
  })

  it('approves the protocol’s spender, never Permit2, on the retry after the order is rejected', async () => {
    let orderRejected = false
    const scenario = buildProtocolPermitScenario({
      onSignTypedData: async (request): Promise<Hex> => {
        if (request.primaryType === 'Order' && !orderRejected) {
          orderRejected = true
          const rejection = new Error('User rejected the request.')
          rejection.name = 'UserRejectedRequestError'
          throw rejection
        }
        return WALLET_SIGNATURE
      },
    })

    await scenario.runExpectingFailure()
    const retryStartsAt = scenario.timeline.length
    await scenario.retry()

    // The retry has no permit left (see C3). Without `skipPermit` it would
    // approve canonical Permit2.
    const allowanceReads = scenario
      .events('readContract', retryStartsAt)
      .filter((event) => event.functionName === 'allowance')
    expect(allowanceReads).toHaveLength(1)
    expect(allowanceReads[0].args[1]).toBe(ORDER_SPENDER)

    const sent = scenario.events('sendTransaction', retryStartsAt)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(FROM_TOKEN_ADDRESS)
    const { spender, amount } = decodeApproval(sent[0].data as Hex)
    expect(spender).toBe(ORDER_SPENDER)
    expect(spender).not.toBe(CANONICAL_PERMIT2)
    expect(spender).not.toBe(LIFI_PERMIT2_PROXY)
    expect(amount).toBe(BigInt(FROM_AMOUNT))

    const signed = scenario.events('signTypedData', retryStartsAt)
    expect(signed.map((event) => event.primaryType)).toEqual(['Order'])
    expect(scenario.events('sendCalls')).toEqual([])
    const [relayed] = scenario.events('relayTransaction', retryStartsAt)
    expect(sent[0].seq).toBeLessThan(signed[0].seq)
    expect(signed[0].seq).toBeLessThan(relayed.seq)
  })
})
