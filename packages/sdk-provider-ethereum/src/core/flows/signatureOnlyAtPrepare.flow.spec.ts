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
import type { Address, Hex } from 'viem'
import {
  APPROVAL_ADDRESS,
  buildPermitWitnessTypedData,
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  decodeApproval,
  FROM_ADDRESS,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  type Scenario,
  type StepFixtureOptions,
  WALLET_SIGNATURE,
} from './harness.mock.js'

/** CoW's GPv2VaultRelayer. Checksummed, because the approve ABI-encodes it. */
const ORDER_SPENDER: Address = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

/** A limit order the tool builds at `/stepTransaction`, not at routes time. */
const ORDER_TYPED_DATA = buildTypedData({
  primaryType: 'Order',
  domain: { name: 'Limit Order Protocol', chainId: CHAIN_ID },
  message: { maker: FROM_ADDRESS, salt: '1' },
})

/**
 * The JUMEMB-102 shape: no typed data or transaction at routes time, an
 * approval needed, an EIP-5792 wallet, and a re-quote with an order only.
 * Before prepare the step looks batchable, so the allowance tasks queue the
 * approve into a batch that the relayed lane never sends.
 */
const buildLateRelayedScenario = (
  stepOptions: StepFixtureOptions = {}
): Scenario =>
  createScenario({
    step: buildStep(stepOptions),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: (step: LiFiStep) => {
      const { transactionRequest: _dropped, ...rest } = step
      return { ...rest, typedData: [ORDER_TYPED_DATA] }
    },
  })

/** A custom step, as a limit-order backend builds it (CoW, 1inch). */
const CUSTOM_STEP: StepFixtureOptions = {
  type: 'jumper',
  tool: 'cowswap',
  approvalAddress: ORDER_SPENDER,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C15 — a step that turns signature-only at prepare replays as relayed', () => {
  it('sends the approval on-chain before the order is signed and relayed', async () => {
    const scenario = buildLateRelayedScenario(CUSTOM_STEP)

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('sendCalls')).toEqual([])
    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(1)
    const [approveTx] = sent
    expect(approveTx.to).toBe(FROM_TOKEN_ADDRESS)

    const [orderSignature] = scenario.events('signTypedData')
    const relayed = scenario.events('relayTransaction')
    expect(relayed).toHaveLength(1)
    expect(approveTx.seq).toBeLessThan(orderSignature.seq)
    expect(orderSignature.seq).toBeLessThan(relayed[0].seq)
    expect(
      relayed[0].typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([['Order', WALLET_SIGNATURE]])
  })

  it('approves the step spender for the exact amount on a custom step', async () => {
    const scenario = buildLateRelayedScenario(CUSTOM_STEP)

    await scenario.run()

    // A custom step keeps Permit2 off in every strategy, so the replay approves
    // the protocol's contract, as the batch would have.
    const [approveTx] = scenario.events('sendTransaction')
    const { spender, amount } = decodeApproval(approveTx.data as Hex)
    expect(spender).toBe(ORDER_SPENDER)
    expect(amount).toBe(BigInt(FROM_AMOUNT))
  })

  it('derives the spender again for the relayed strategy instead of reusing the batch', async () => {
    // A LI.FI step: the relayed lane pulls through Permit2, while the batch
    // queued an approve to the diamond. Flushing that call would approve the
    // wrong contract.
    const scenario = buildLateRelayedScenario()

    await scenario.run()

    expect(scenario.events('sendCalls')).toEqual([])
    const [approveTx] = scenario.events('sendTransaction')
    const { spender } = decodeApproval(approveTx.data as Hex)
    expect(spender).toBe(CANONICAL_PERMIT2)
    expect(spender).not.toBe(APPROVAL_ADDRESS)
  })

  it('re-quotes once per attempt and discards the first attempt', async () => {
    const scenario = buildLateRelayedScenario(CUSTOM_STEP)

    await scenario.run()

    // Attempt 2 starts from a cleared execution object, so the
    // `SET_ALLOWANCE:DONE` that attempt 1 reported for the queued call is gone.
    expect(scenario.events('getStepTransaction')).toHaveLength(2)
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      // Attempt 1 — batched until prepare.
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      // Attempt 2 — relayed from the first task.
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
      'SWAP:PENDING',
    ])

    // Attempt 2 asks no wallet capabilities: the retry says it is relayed. It
    // runs the same gas check as attempt 1, because prepare restored the
    // step's typed data, and the wallet pays for the approve.
    expect(
      scenario
        .kinds()
        .filter((kind) => kind !== 'action' && kind !== 'routeUpdate')
    ).toEqual([
      'getCapabilities',
      'readContract',
      'getCode',
      'getStepTransaction',
      'readContract',
      'sendTransaction',
      'getCode',
      'getStepTransaction',
      'signTypedData',
      'relayTransaction',
    ])

    const allowanceDone = scenario
      .events('action')
      .filter(
        (event) =>
          event.actionType === 'SET_ALLOWANCE' && event.status === 'DONE'
      )
      .at(-1)
    expect(allowanceDone?.txHash).toBeDefined()
    expect(scenario.finalActions()).toContain('SET_ALLOWANCE:DONE')
  })

  it('replays when an allowance to the batch spender hid a missing Permit2 allowance', async () => {
    // Symptom B: the diamond is already approved, so the batch queues nothing,
    // but the relayed lane needs a Permit2 allowance.
    const scenario = createScenario({
      step: buildStep(),
      allowanceBySpender: { [APPROVAL_ADDRESS]: 10n ** 24n },
      capabilities: { atomic: { status: 'supported' } },
      onStepTransaction: (step: LiFiStep) => {
        const { transactionRequest: _dropped, ...rest } = step
        return { ...rest, typedData: [ORDER_TYPED_DATA] }
      },
    })

    await scenario.run()

    // Attempt 1 queued nothing, so the spender check caused the replay.
    const [firstRequote] = scenario.events('getStepTransaction')
    expect(
      scenario
        .events('action')
        .filter((event) => event.seq < firstRequote.seq)
        .map((event) => event.actionType)
    ).not.toContain('SET_ALLOWANCE')

    const allowanceReads = scenario
      .events('readContract')
      .filter((event) => event.functionName === 'allowance')
      .map((event) => event.args[1])
    expect(allowanceReads).toEqual([APPROVAL_ADDRESS, CANONICAL_PERMIT2])
    expect(scenario.events('getStepTransaction')).toHaveLength(2)
    expect(scenario.events('sendCalls')).toEqual([])
    const [approveTx] = scenario.events('sendTransaction')
    expect(decodeApproval(approveTx.data as Hex).spender).toBe(
      CANONICAL_PERMIT2
    )
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })

  it('re-quotes the replay through /stepTransaction, as the first attempt did', async () => {
    // The first re-quote answers with gasless typed data. Left on the step, it
    // would send the replay's re-quote to the relayer endpoint instead.
    const scenario = createScenario({
      step: buildStep(),
      capabilities: { atomic: { status: 'supported' } },
      onStepTransaction: (step: LiFiStep) => {
        const { transactionRequest: _dropped, ...rest } = step
        return { ...rest, typedData: [buildPermitWitnessTypedData()] }
      },
    })

    await scenario.run()

    expect(scenario.events('getStepTransaction')).toHaveLength(2)
    expect(scenario.events('getRelayerQuote')).toEqual([])
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })

  it('does not replay after the standard strategy, where the approval is already on-chain', async () => {
    // No EIP-5792 batching, and a smart account that fails the Permit2 probe,
    // so `standard` approves the diamond on-chain. A replay would only ask for
    // a second approval.
    const scenario = createScenario({
      step: buildStep(),
      accountCode: '0xef0100aabbccddeeff00112233445566778899aabbcc',
      erc1271Response: 'revert',
      onStepTransaction: (step: LiFiStep) => {
        const { transactionRequest: _dropped, ...rest } = step
        return { ...rest, typedData: [ORDER_TYPED_DATA] }
      },
    })

    await scenario.run()

    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(1)
    expect(decodeApproval(sent[0].data as Hex).spender).toBe(APPROVAL_ADDRESS)
  })

  it('needs no replay when the spender is the same and nothing was queued', async () => {
    const scenario = createScenario({
      step: buildStep(CUSTOM_STEP),
      allowance: 10n ** 24n,
      capabilities: { atomic: { status: 'supported' } },
      onStepTransaction: (step: LiFiStep) => {
        const { transactionRequest: _dropped, ...rest } = step
        return { ...rest, typedData: [ORDER_TYPED_DATA] }
      },
    })

    await scenario.run()

    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })

  it('needs no replay when the backend declares the step a message', async () => {
    // With `executionType: 'message'` the allowance tasks run as relayed from
    // the start, so nothing is queued.
    const scenario = buildLateRelayedScenario({
      ...CUSTOM_STEP,
      executionType: 'message',
    })

    await scenario.run()

    expect(scenario.events('getStepTransaction')).toHaveLength(1)
    expect(scenario.events('sendCalls')).toEqual([])
    expect(scenario.events('sendTransaction')).toHaveLength(1)
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })
})
