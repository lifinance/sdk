import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
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

import { LiFiErrorCode, type LiFiStep, type SDKError } from '@lifi/sdk'
import { UserRejectedRequestError } from 'viem'
import {
  answerWithCaliburGasless,
  answerWithPermit2Gasless,
  buildGaslessRouteStep,
} from './gaslessStep.mock.js'
import {
  CANONICAL_PERMIT2,
  createScenario,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  NATIVE_TOKEN,
  type Scenario,
  type ScenarioOptions,
  WALLET_SIGNATURE,
} from './harness.mock.js'

/** A user with no native gas at all, the case gasless exists for. */
const NO_GAS = { [NATIVE_TOKEN.address.toLowerCase()]: 0n }

const BATCHING_WALLET = { atomic: { status: 'supported' } }

const buildScenario = (overrides: Partial<ScenarioOptions> = {}): Scenario =>
  createScenario({
    step: buildGaslessRouteStep(),
    onStepTransaction: answerWithPermit2Gasless,
    balances: NO_GAS,
    // Zero on purpose: any allowance task that ran would find a shortfall and
    // approve, so the absence assertions below are load-bearing.
    allowance: 0n,
    ...overrides,
  })

const expectNothingSentOnChain = (scenario: Scenario): void => {
  expect(scenario.events('sendTransaction')).toEqual([])
  expect(scenario.events('sendCalls')).toEqual([])
  const actionTypes = scenario.events('action').map((e) => e.actionType)
  expect(actionTypes).not.toContain('CHECK_ALLOWANCE')
  expect(actionTypes).not.toContain('SET_ALLOWANCE')
  expect(actionTypes).not.toContain('RESET_ALLOWANCE')
  expect(actionTypes).not.toContain('NATIVE_PERMIT')
  expect(actionTypes).not.toContain('PERMIT')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each([
  ['a standard wallet', {}],
  ['a batching wallet', { capabilities: BATCHING_WALLET }],
])('G1 — permit2 gasless step with %s', (_name, walletOptions) => {
  it('needs no native gas, sends nothing on chain and signs no SDK permit', async () => {
    const scenario = buildScenario(walletOptions)

    await scenario.run()

    expectNothingSentOnChain(scenario)
    // The SDK's own native permit authorises the Permit2Proxy. A gasless step
    // signs only the backend's permit, which tops up canonical Permit2.
    const permits = scenario
      .events('signTypedData')
      .filter((e) => e.primaryType === 'Permit')
    expect(permits.map((e) => e.message.spender)).toEqual([CANONICAL_PERMIT2])
    expect(permits.map((e) => e.message.spender)).not.toContain(
      LIFI_PERMIT2_PROXY
    )
  })

  it('signs the backend Permit, then the witness, and relays exactly those two', async () => {
    const scenario = buildScenario(walletOptions)

    await scenario.run()

    expect(scenario.events('signTypedData').map((e) => e.primaryType)).toEqual([
      'Permit',
      'PermitWitnessTransferFrom',
    ])
    const relayed = scenario.events('relayTransaction')
    expect(relayed).toHaveLength(1)
    expect(
      relayed[0].typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['Permit', WALLET_SIGNATURE],
      ['PermitWitnessTransferFrom', WALLET_SIGNATURE],
    ])
  })

  it('re-quotes through /stepTransaction once, never through the relayer quote', async () => {
    const scenario = buildScenario(walletOptions)

    await scenario.run()

    expect(scenario.events('getStepTransaction')).toHaveLength(1)
  })
})

describe('G2 — calibur gasless step (EIP-7702 delegated account)', () => {
  it('signs the SignedBatchedCall and relays it, with nothing sent on chain', async () => {
    const scenario = buildScenario({
      onStepTransaction: answerWithCaliburGasless,
    })

    await scenario.run()

    expectNothingSentOnChain(scenario)
    expect(scenario.events('signTypedData').map((e) => e.primaryType)).toEqual([
      'SignedBatchedCall',
    ])
    expect(
      scenario
        .events('relayTransaction')[0]
        .typedData.map((entry) => entry.primaryType)
    ).toEqual(['SignedBatchedCall'])
  })
})

describe('G3 — batching wallet', () => {
  it('queues no calls and runs the step once, without a strategy replay', async () => {
    const scenario = buildScenario({ capabilities: BATCHING_WALLET })

    await scenario.run()

    expect(scenario.events('sendCalls')).toEqual([])
    // A STRATEGY_AFTER_PREPARE replay re-quotes a second time.
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
  })
})

describe('G4 — token balance', () => {
  it('still fails with BalanceError when the token balance is below fromAmount', async () => {
    const scenario = buildScenario({
      balances: { ...NO_GAS, [FROM_TOKEN_ADDRESS.toLowerCase()]: 1n },
    })

    const error = (await scenario.runExpectingFailure()) as SDKError

    expect(error.cause?.name).toBe('BalanceError')
    expect(scenario.events('relayTransaction')).toEqual([])
  })
})

describe('G5 — retry after a rejected signature', () => {
  it('re-quotes a step without the stale typed data and signs the new typed data', async () => {
    const requested: LiFiStep[] = []
    const scenario = buildScenario({
      onStepTransaction: (step) => {
        requested.push(step)
        return answerWithPermit2Gasless(step)
      },
      onSignTypedData: async (_request, callIndex) => {
        if (callIndex === 0) {
          throw new UserRejectedRequestError(new Error('rejected'))
        }
        return WALLET_SIGNATURE
      },
    })

    await scenario.runExpectingFailure()
    await scenario.retry()

    expect(requested).toHaveLength(2)
    for (const step of requested) {
      expect(step).not.toHaveProperty('typedData')
      expect(step).not.toHaveProperty('expiresAt')
      expect(step).not.toHaveProperty('authorization')
    }
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })
})

describe('G6 — disableMessageSigning', () => {
  it('fails before prepare, because a gasless step is executed by a signature', async () => {
    const scenario = buildScenario({ disableMessageSigning: true })

    const error = (await scenario.runExpectingFailure()) as SDKError

    expect(error.cause?.name).toBe('TransactionError')
    expect(error.code).toBe(LiFiErrorCode.TransactionUnprepared)
    expect(error.message).toMatch(/gasless/i)
    expect(error.message).toMatch(/message signing/i)
    expect(scenario.events('getStepTransaction')).toEqual([])
    expect(scenario.events('signTypedData')).toEqual([])
  })
})

describe('G7 — an EIP-7702 authorization in the answer', () => {
  it('fails before any signature, because the relayer cannot submit it yet', async () => {
    const scenario = buildScenario({
      onStepTransaction: (step) =>
        ({
          ...answerWithCaliburGasless(step),
          authorization: {
            chainId: 137,
            address: `0x${'cc'.repeat(20)}`,
            nonce: 0,
          },
        }) as LiFiStep,
    })

    const error = (await scenario.runExpectingFailure()) as SDKError

    expect(error.code).toBe(LiFiErrorCode.TransactionUnprepared)
    expect(error.message).toMatch(/authorization/i)
    expect(scenario.events('signTypedData')).toEqual([])
    expect(scenario.events('relayTransaction')).toEqual([])
  })
})
