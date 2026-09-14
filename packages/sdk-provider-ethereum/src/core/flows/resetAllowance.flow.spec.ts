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
import { MaxUint256 } from '../../permits/constants.js'
import {
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  CANONICAL_PERMIT2,
  createScenario,
  decodeApproval,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
} from './harness.mock.js'

/** Non-zero but short of `FROM_AMOUNT` — the USDT-style token's whole problem. */
const STALE_ALLOWANCE = 1000n

/**
 * The `approvalReset` lane: a token that refuses a non-zero to non-zero
 * allowance change, so the quote sets `estimate.approvalReset` and the SDK has
 * to zero the allowance before it can raise it again.
 *
 * `EthereumResetAllowanceTask.shouldRun` needs all four of: no matching permit,
 * an insufficient allowance, `approvalReset`, and a *non-zero* existing
 * allowance. A zero allowance skips the reset, which is why
 * {@link STALE_ALLOWANCE} is not `0n`.
 */
const buildResetScenario = (): Scenario =>
  createScenario({
    step: buildStep({
      transactionRequest: buildTransactionRequest(),
      approvalReset: true,
    }),
    allowance: STALE_ALLOWANCE,
    // No EIP-2612 support, so the native-permit task bows out and the flow
    // lands on the Permit2 approve path the reset guards.
    nativePermitSupported: false,
    accountCode: '0x',
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C9 — approvalReset zeroes the allowance before raising it', () => {
  it('sends the reset before the approve, both to the token', async () => {
    const scenario = buildResetScenario()

    await scenario.run()

    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(3)

    const [reset, approve, swap] = sent
    expect(reset.to).toBe(FROM_TOKEN_ADDRESS)
    expect(approve.to).toBe(FROM_TOKEN_ADDRESS)
    // The ordering claim, read off the shared timeline rather than two spies.
    expect(reset.seq).toBeLessThan(approve.seq)
    expect(approve.seq).toBeLessThan(swap.seq)
  })

  it('names the same spender in both, and zero then unlimited', async () => {
    const scenario = buildResetScenario()

    await scenario.run()

    const [reset, approve] = scenario.events('sendTransaction')

    // `EthereumResetAllowanceTask.ts:60-62` and
    // `EthereumSetAllowanceTask.ts:60-62` resolve the spender identically, so
    // the reset and the approve address the same contract — canonical Permit2,
    // never the Permit2Proxy the swap is later sent to.
    const resetCall = decodeApproval(reset.data as Hex)
    const approveCall = decodeApproval(approve.data as Hex)
    expect(resetCall.spender).toBe(CANONICAL_PERMIT2)
    expect(approveCall.spender).toBe(CANONICAL_PERMIT2)
    // Fixture-drift guards: the two Permit2 addresses and the diamond must
    // stay distinct for the equalities above to carry any meaning.
    expect(resetCall.spender).not.toBe(LIFI_PERMIT2_PROXY)
    expect(resetCall.spender).not.toBe(APPROVAL_ADDRESS)

    expect(resetCall.amount).toBe(0n)
    expect(approveCall.amount).toBe(MaxUint256)
  })

  it('reports RESET_ALLOWANCE all the way to DONE, unlike the review claimed', async () => {
    const scenario = buildResetScenario()

    await scenario.run()

    // Pinned as observed, and worth stating because it is easy to get wrong:
    // `EthereumResetAllowanceTask` *does* reach DONE
    // (EthereumResetAllowanceTask.ts:119). What differs from
    // `EthereumSetAllowanceTask.ts:116` is that the reset's DONE carries no
    // `txHash` parameter of its own — the hash survives only because the
    // preceding PENDING already wrote it onto the same action object.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:STARTED',
      'NATIVE_PERMIT:DONE',
      'RESET_ALLOWANCE:STARTED',
      'RESET_ALLOWANCE:RESET_REQUIRED',
      'RESET_ALLOWANCE:PENDING',
      'RESET_ALLOWANCE:PENDING',
      'RESET_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
    ])

    // And the list a consumer renders: five entries, in creation order, with
    // the reset ahead of the approve.
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:DONE',
      'RESET_ALLOWANCE:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
    ])
  })
})
