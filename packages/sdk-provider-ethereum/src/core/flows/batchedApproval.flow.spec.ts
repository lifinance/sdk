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

import type { Hex } from 'viem'
import {
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  CANONICAL_PERMIT2,
  createScenario,
  decodeApproval,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
} from './harness.mock.js'

/**
 * No typed data, an allowance of zero and a wallet that advertises EIP-5792
 * atomic batching for the source chain.
 */
const buildBatchedScenario = (): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C8 — batched approval through EIP-5792', () => {
  it('sends no standalone approval transaction', async () => {
    const scenario = buildBatchedScenario()

    await scenario.run()

    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('sendCalls')).toHaveLength(1)
  })

  it('batches the approve and the swap, in that order', async () => {
    const scenario = buildBatchedScenario()

    await scenario.run()

    const [batch] = scenario.events('sendCalls')
    expect(batch.calls).toHaveLength(2)

    const [approve, swap] = batch.calls
    expect(approve.to).toBe(FROM_TOKEN_ADDRESS)
    expect(swap.to).toBe(APPROVAL_ADDRESS)
    expect(swap.data).toBe(buildTransactionRequest().data)
  })

  it('approves the diamond for the exact amount, never Permit2', async () => {
    const scenario = buildBatchedScenario()

    await scenario.run()

    const [batch] = scenario.events('sendCalls')
    const { spender, amount } = decodeApproval(batch.calls[0].data as Hex)

    // Permit2 is deliberately unavailable for an atomic batch
    // (`resolvePermit2Support` rejects the `batched` strategy), so the spender
    // is the `approvalAddress` from the quote and the amount is exact.
    // Fixture-drift guards on the two Permit2 addresses: the claim of this
    // scenario is that neither is used, so they must stay distinct from the
    // diamond for the positive assertion above to mean anything.
    expect(spender).toBe(APPROVAL_ADDRESS)
    expect(spender).not.toBe(CANONICAL_PERMIT2)
    expect(spender).not.toBe(LIFI_PERMIT2_PROXY)
    expect(amount).toBe(BigInt(FROM_AMOUNT))

    // The native-permit task is skipped outright, so the consumer never even
    // sees a NATIVE_PERMIT action here (contrast C7, where it appears and
    // completes having done nothing).
    expect(
      scenario.events('action').map((event) => event.actionType)
    ).not.toContain('NATIVE_PERMIT')
  })

  it('reports the allowance DONE before the batch is sent', async () => {
    const scenario = buildBatchedScenario()

    await scenario.run()

    const allowanceDone = scenario
      .events('action')
      .find(
        (event) =>
          event.actionType === 'SET_ALLOWANCE' && event.status === 'DONE'
      )
    const batches = scenario.events('sendCalls')
    expect(batches).toHaveLength(1)
    const [batch] = batches

    // PINNED DELIBERATELY, AND IT LOOKS LIKE A BUG.
    //
    // `EthereumSetAllowanceTask.run`, in its batched branch,
    // marks SET_ALLOWANCE as DONE in the batched branch the moment it has
    // *encoded* the approve call. The approve has not been submitted, signed or
    // even shown to the user at that point: it is only pushed onto
    // `context.calls`, and `EthereumBatchedSignAndExecuteTask` submits the
    // batch much later. A consumer watching the action stream is told the
    // approval succeeded while nothing has left the wallet, and if the user
    // then rejects the batch the approval is reported DONE for a transaction
    // that never existed.
    //
    // This test asserts the behaviour as it ships, not the behaviour it
    // should have. Change the task and change this expectation with it.
    expect(allowanceDone).toBeDefined()
    expect(allowanceDone!.seq).toBeLessThan(batch.seq)

    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
    ])

    // What the consumer's list looks like while the batch prompt is open: the
    // approval already reads DONE and it is the *swap* the headline names, so
    // the misreport above is visible in the rendered list, not just the call
    // stream.
    expect(scenario.events('sendCalls')[0].actions).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:ACTION_REQUIRED',
    ])
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
    ])

    // The non-batched path does not behave this way: there SET_ALLOWANCE only
    // reaches DONE after the approve receipt is in hand. See C7's pinned
    // sequence, where PENDING carries a transaction hash before DONE.
    expect(allowanceDone!.txHash).toBeUndefined()
  })
})
