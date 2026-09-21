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
import type { Hex } from 'viem'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import { MaxUint256 } from '../../permits/constants.js'
import {
  buildStep,
  buildTransactionRequest,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  decodeApproval,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  futureDeadline,
  type Scenario,
  THIRD_PARTY_ROUTER,
} from './harness.mock.js'

/**
 * The same `PermitSingle` as C2 — a third-party spender, verified by canonical
 * Permit2 — on a step that DOES receive its transaction. The caller signs the
 * message and then sends the swap itself.
 */
const PERMIT_SINGLE = buildTypedData({
  primaryType: 'PermitSingle',
  domain: {
    name: 'Permit2',
    chainId: CHAIN_ID,
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

const SWAP_REQUEST = buildTransactionRequest({ to: THIRD_PARTY_ROUTER })

/**
 * Typed data at routes time, the transaction only at `/stepTransaction` — the
 * order a real quote arrives in. The approval target is the contract the
 * message names as its verifier, which is what Permit2 requires.
 */
const buildScenario = (): Scenario =>
  createScenario({
    step: buildStep({
      typedData: [PERMIT_SINGLE],
      approvalAddress: CANONICAL_PERMIT2,
    }),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: (step: LiFiStep) => ({
      ...step,
      typedData: [PERMIT_SINGLE],
      transactionRequest: SWAP_REQUEST,
    }),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C14 — a Permit2 allowance on a step that does receive a transaction', () => {
  it('signs the message and sends the swap itself, never relaying', async () => {
    const scenario = buildScenario()

    await scenario.run()

    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['PermitSingle'])
    expect(scenario.events('relayTransaction')).toEqual([])
  })

  /**
   * The capability the phase-bound rule in `getEthereumExecutionStrategy`
   * exists to protect. The allowance tasks run BEFORE prepare, where this step
   * and C2's capture-only step are indistinguishable. Calling either one
   * `relayed` there turns batching off, and the user pays for two prompts.
   */
  it('still batches the approval with the swap', async () => {
    const scenario = buildScenario()

    await scenario.run()

    expect(scenario.events('sendTransaction')).toEqual([])
    const [batch] = scenario.events('sendCalls')
    expect(batch.calls).toHaveLength(2)

    const [approve, swap] = batch.calls
    expect(approve.to).toBe(FROM_TOKEN_ADDRESS)
    expect(swap.to).toBe(THIRD_PARTY_ROUTER)
  })

  it('approves the contract that verifies the message, for the max amount', async () => {
    const scenario = buildScenario()

    await scenario.run()

    const [approve] = scenario.events('sendCalls')[0].calls
    expect(decodeApproval(approve.data as Hex)).toEqual({
      spender: CANONICAL_PERMIT2,
      amount: MaxUint256,
    })
  })

  // The mirror of C2's waiter assertion. The lane the signature took and the
  // lane the wait takes are one stored verdict, so pinning both shapes is what
  // keeps them from drifting apart.
  it('never waits on the relayer', async () => {
    const scenario = buildScenario()

    await scenario.run()

    // The batched lane settles through `waitForCallsStatus`, so neither
    // single-transaction waiter runs here. What matters is that the relayed one
    // does not: this step sent its own transaction.
    expect(waitForRelayedTransactionReceipt).not.toHaveBeenCalled()
    expect(waitForTransactionReceipt).not.toHaveBeenCalled()
  })
})
