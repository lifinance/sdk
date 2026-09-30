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

/**
 * The contract the protocol pulls the sold tokens with — CoW's GPv2VaultRelayer.
 * A valid checksummed address, because the retry ABI-encodes it into an approve.
 */
const ORDER_SPENDER: Address = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

const ORDER_TYPED_DATA = buildTypedData({
  primaryType: 'Order',
  domain: { name: 'Gnosis Protocol', chainId: CHAIN_ID },
  message: { sellToken: FROM_TOKEN_ADDRESS, receiver: FROM_ADDRESS },
})

/**
 * A limit order whose protocol pulls the tokens with its own contract, as the
 * Jumper limit-order backend builds it for a token with an EIP-2612 permit (CoW
 * and 1inch, JUMEMB-121): the permit names that contract, the approval address
 * is that contract too, `skipPermit` keeps LI.FI's Permit2 flows out, and
 * `executionType: 'message'` says at routes time that the order is relayed.
 * `/stepTransaction` answers with the order to sign and no transaction.
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

    // The backend builds the pre-hook from the signed permit it receives here.
    expect(posted).toHaveLength(1)
    expect(
      (posted[0] as SignedTypedData[]).map((entry) => [
        entry.primaryType,
        entry.signature,
      ])
    ).toEqual([['Permit', WALLET_SIGNATURE]])

    // Relayed in signing order, which is why the backend must pick the order
    // by type and not by position.
    const [relayed] = scenario.events('relayTransaction')
    expect(
      relayed.typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['Permit', WALLET_SIGNATURE],
      ['Order', WALLET_SIGNATURE],
    ])

    // The permit replaces the approval: nothing is sent, batched or read.
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

    // The retry no longer holds the permit (attempt 1 re-quoted the order into
    // `step.typedData`; see C3), so it takes the allowance path. Without
    // `skipPermit` that path reads and approves canonical Permit2 for a relayed
    // step, and the protocol could not pull the tokens (C3 pins that read).
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

    // Neither a Permit2Proxy permit nor a batch: the approve is a real
    // transaction, sent before the order is signed and relayed.
    const signed = scenario.events('signTypedData', retryStartsAt)
    expect(signed.map((event) => event.primaryType)).toEqual(['Order'])
    expect(scenario.events('sendCalls')).toEqual([])
    const [relayed] = scenario.events('relayTransaction', retryStartsAt)
    expect(sent[0].seq).toBeLessThan(signed[0].seq)
    expect(signed[0].seq).toBeLessThan(relayed.seq)
  })
})
