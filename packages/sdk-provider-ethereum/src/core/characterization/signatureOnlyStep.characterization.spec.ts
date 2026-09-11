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

import type { LiFiStep } from '@lifi/sdk'
import {
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  createScenario,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  futureDeadline,
  LIFI_PERMIT2_PROXY,
  type Scenario,
  THIRD_PARTY_ROUTER,
  WALLET_SIGNATURE,
} from './harness.js'

/**
 * A Permit2 `PermitSingle` whose spender is a third-party router — not
 * canonical Permit2, not the Permit2Proxy, not the LI.FI diamond.
 *
 * `PermitSingle` is not a member of `TypedDataPrimaryType` in `@lifi/types`
 * 18.5.0, so the fixture has to widen the literal. Nothing in the pipeline
 * validates the primary type, which is exactly why this step still executes.
 */
const PERMIT_SINGLE = buildTypedData({
  primaryType: 'PermitSingle',
  domain: {
    name: 'Permit2',
    chainId: 137,
    verifyingContract: CANONICAL_PERMIT2,
  },
  message: {
    details: {
      token: FROM_TOKEN_ADDRESS,
      amount: FROM_AMOUNT,
      expiration: futureDeadline(),
      nonce: '0',
    },
    spender: THIRD_PARTY_ROUTER,
    sigDeadline: futureDeadline(),
  },
})

/**
 * A signature-only step: no approval address, approvals and permits both
 * skipped, and a re-quote that answers with typed data and **never** a
 * transaction request.
 */
const buildSignatureOnlyScenario = (): Scenario =>
  createScenario({
    step: buildStep({
      typedData: [PERMIT_SINGLE],
      approvalAddress: '',
      skipApproval: true,
      skipPermit: true,
    }),
    onStepTransaction: (step: LiFiStep) => {
      const { transactionRequest: _dropped, ...rest } = step
      return { ...rest, typedData: [PERMIT_SINGLE] }
    },
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C2 — a step that is only ever a signature', () => {
  it('executes to a relayed transaction without throwing', async () => {
    const scenario = buildSignatureOnlyScenario()

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('relayTransaction')).toHaveLength(1)
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
  })

  it('resolves to the relayed strategy and signs the one message', async () => {
    const scenario = buildSignatureOnlyScenario()

    await scenario.run()

    // `MESSAGE_REQUIRED` is raised only by the relayed sign-and-execute task,
    // so seeing it is the observable proof the strategy resolved to 'relayed'.
    // The standard and batched tasks both demand a transaction request, which
    // this step never has.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
      'SWAP:PENDING',
    ])

    const signatures = scenario.events('signTypedData')
    expect(signatures.map((event) => event.primaryType)).toEqual([
      'PermitSingle',
    ])
    expect(signatures[0].message.spender).toBe(THIRD_PARTY_ROUTER)
    expect(signatures[0].message.spender).not.toBe(CANONICAL_PERMIT2)
    expect(signatures[0].message.spender).not.toBe(LIFI_PERMIT2_PROXY)

    expect(
      scenario
        .events('relayTransaction')[0]
        .typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([['PermitSingle', WALLET_SIGNATURE]])
  })

  it('skips every allowance and permit task before it starts', async () => {
    const scenario = buildSignatureOnlyScenario()

    await scenario.run()

    // An empty `approvalAddress` makes `shouldCheckForAllowance` false, so
    // `createPipeline` starts the pipeline at `EthereumCheckBalanceTask` and
    // the five tasks before it never even get a `shouldRun` call.
    expect(
      scenario.events('action').map((event) => event.actionType)
    ).not.toContain('PERMIT')
    expect(scenario.events('readContract')).toEqual([])
  })

  it('uses /stepTransaction, which answers with typed data and no transaction', async () => {
    const scenario = buildSignatureOnlyScenario()

    await scenario.run()

    // `isGaslessStep` is false — no `PermitWitnessTransferFrom`, and
    // `getUpdatedStep` calls it without a chain, so its `chain.permit2`
    // spender branch cannot fire — so the standard endpoint is used even
    // though this step is a relayer step.
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    expect(scenario.events('getRelayerQuote')).toEqual([])
    expect(scenario.executedStep().transactionRequest).toBeUndefined()
  })
})
