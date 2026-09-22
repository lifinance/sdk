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
  buildPermitTypedData,
  buildPermitWitnessTypedData,
  buildStep,
  CANONICAL_PERMIT2,
  createScenario,
  LIFI_PERMIT2_PROXY,
  type Scenario,
  WALLET_SIGNATURE,
} from './harness.mock.js'

/**
 * The gasless two-entry shape the LI.FI relayer emits when the user's Permit2
 * allowance is short: an EIP-2612 `Permit` that tops up the allowance held by
 * **canonical Permit2**, plus the `PermitWitnessTransferFrom` that authorises
 * the **Permit2Proxy** to spend it — a witness Permit2 itself verifies, hence
 * the canonical address in its domain.
 */
const buildGaslessScenario = (): Scenario =>
  createScenario({
    step: buildStep({
      typedData: [
        buildPermitTypedData(CANONICAL_PERMIT2),
        buildPermitWitnessTypedData(),
      ],
    }),
    // Zero on purpose: if any allowance task ran it would find a shortfall and
    // send an approval, so the absence assertions below are load-bearing.
    allowance: 0n,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C1 — gasless step with a permit and a witness', () => {
  it('signs the permit first and the witness second', async () => {
    const scenario = buildGaslessScenario()

    await scenario.run()

    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['Permit', 'PermitWitnessTransferFrom'])
  })

  it('keeps Permit2 and the Permit2Proxy in their own roles', async () => {
    const scenario = buildGaslessScenario()

    await scenario.run()

    const [permit, witness] = scenario.events('signTypedData')

    // The permit tops up the allowance canonical Permit2 holds, and is
    // verified by the token itself.
    expect(permit.message.spender).toBe(CANONICAL_PERMIT2)
    expect(permit.domain.verifyingContract).toBe(
      scenario.executedStep().action.fromToken.address
    )

    // The witness authorises the *proxy* to pull through Permit2, and is
    // verified by canonical Permit2. Spender and verifier are different
    // contracts; conflating them is the classic error in this area.
    expect(witness.message.spender).toBe(LIFI_PERMIT2_PROXY)
    expect(witness.domain.verifyingContract).toBe(CANONICAL_PERMIT2)
  })

  it('runs no allowance task and sends no approval transaction', async () => {
    const scenario = buildGaslessScenario()

    await scenario.run()

    // The permits task reports a permit matching the source chain, which makes
    // `hasMatchingPermit` true. Every allowance-shaped task gates on that, so
    // the consumer never sees an allowance action at all.
    const actionTypes = scenario
      .events('action')
      .map((event) => event.actionType)
    expect(actionTypes).not.toContain('CHECK_ALLOWANCE')
    expect(actionTypes).not.toContain('SET_ALLOWANCE')
    expect(actionTypes).not.toContain('RESET_ALLOWANCE')
    expect(actionTypes).not.toContain('NATIVE_PERMIT')

    // Every `StatusManager` call, in the order it was made.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'PERMIT:STARTED',
      'PERMIT:ACTION_REQUIRED',
      'PERMIT:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
      'SWAP:PENDING',
    ])

    // And the array those calls produced — `step.execution.actions`, which is
    // what a consumer actually renders. It is a different thing from the call
    // order above: `updateAction` re-sorts DONE-first and `initializeAction`
    // reuses an action of the same type, so two actions here, not nine.
    expect(scenario.finalActions()).toEqual(['PERMIT:DONE', 'SWAP:PENDING'])

    // Asserted as an absence, explicitly: no allowance is even read, and
    // nothing is sent on chain — not to Permit2, not to the proxy, not to the
    // diamond.
    expect(scenario.events('readContract')).toEqual([])
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
  })

  it('relays both messages, having asked the wallet only for the witness', async () => {
    const scenario = buildGaslessScenario()

    await scenario.run()

    const relayed = scenario.events('relayTransaction')
    expect(relayed).toHaveLength(1)

    // The relayed task re-signs nothing: `isNativePermitValid` matches the
    // already-signed permit against the first entry and filters it out, so the
    // wallet is asked for the witness alone — but both signatures are relayed.
    //
    // This holds because the relayer re-quote answers with the same `Permit`
    // (same spender, owner, value and deadline), which is what the harness
    // default does. A relayer that answered with a fresh nonce would fail the
    // match and the permit would be signed a second time — so a failure here
    // means the re-quote changed, not that the filter broke.
    //
    // The boundary is the creation of the SWAP action by `CheckBalanceTask`:
    // every task that can sign before it (only `EthereumCheckPermitsTask` here)
    // has already run, and everything after it belongs to the prepare +
    // sign-and-execute leg. `MESSAGE_REQUIRED` would be the wrong boundary —
    // `EthereumStandardSignAndExecuteTask.ts:82` raises it too, so it does not
    // identify the relayed task. Test 1 pins the full signature list, so the
    // pair of assertions is exact from both ends.
    const swapActionStartsAt = scenario
      .events('action')
      .find((event) => event.actionType === 'SWAP')!.seq
    expect(
      scenario
        .events('signTypedData', swapActionStartsAt)
        .map((event) => event.primaryType)
    ).toEqual(['PermitWitnessTransferFrom'])

    // What the widget shows while each signature is pending: it reads
    // `actions.at(-1)` for its headline and its icon.
    expect(
      scenario.events('signTypedData').map((event) => event.actions.at(-1))
    ).toEqual(['PERMIT:ACTION_REQUIRED', 'SWAP:MESSAGE_REQUIRED'])
    expect(
      relayed[0].typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['Permit', WALLET_SIGNATURE],
      ['PermitWitnessTransferFrom', WALLET_SIGNATURE],
    ])
  })

  it('re-quotes through the relayer endpoint, not /stepTransaction', async () => {
    const scenario = buildGaslessScenario()

    await scenario.run()

    // `isGaslessStep` is true because of the `PermitWitnessTransferFrom` entry,
    // so `getUpdatedStep` takes the relayer branch. Compare C3, where an
    // EIP-2612 permit alone keeps the step on `getStepTransaction`.
    expect(scenario.events('getRelayerQuote')).toHaveLength(1)
    expect(scenario.events('getStepTransaction')).toEqual([])
  })
})
