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

import type { LiFiStep, TypedData } from '@lifi/sdk'
import {
  buildStep,
  buildTypedData,
  createScenario,
  FROM_ADDRESS,
  type Scenario,
  THIRD_PARTY_ROUTER,
  WALLET_SIGNATURE,
} from './harness.js'

const HYPERLIQUID_DOMAIN = {
  chainId: 137,
  name: 'HyperliquidSignTransaction',
  version: '1',
}

const NONCE_MAPPING = buildTypedData({
  primaryType: 'NonceMapping',
  domain: { chainId: 137 },
  message: { nonce: '1', owner: FROM_ADDRESS },
})

const SEND_ASSET = buildTypedData({
  primaryType: 'HyperliquidTransaction:SendAsset',
  domain: HYPERLIQUID_DOMAIN,
  message: { destination: FROM_ADDRESS, amount: '1.5', token: 'USDC' },
})

const APPROVE_BUILDER_FEE = buildTypedData({
  primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
  domain: HYPERLIQUID_DOMAIN,
  message: { maxFeeRate: '0.1%', builder: THIRD_PARTY_ROUTER, nonce: '1' },
})

const APPROVE_AGENT = buildTypedData({
  primaryType: 'HyperliquidTransaction:ApproveAgent',
  domain: HYPERLIQUID_DOMAIN,
  message: {
    agentAddress: '0x0000000000000000000000000000000000000009',
    agentName: 'lifi',
    nonce: '2',
  },
})

/**
 * The order the agent wallet signs. Unlike every other fixture here this one
 * needs real EIP-712 `types`: it is signed by a *local* viem account, which
 * validates the payload, not by the scripted wallet.
 */
const AGENT_ORDER = {
  primaryType: 'Agent',
  domain: {
    chainId: 1337,
    name: 'Exchange',
    version: '1',
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  },
  message: { source: 'a', connectionId: `0x${'22'.repeat(32)}` },
} as unknown as TypedData

/**
 * A pure multi-message relayer intent: no approval address, so the pipeline
 * starts at the balance check and nothing but the signing sequence is on the
 * timeline.
 */
const buildIntentScenario = (typedData: TypedData[], tool?: string): Scenario =>
  createScenario({
    step: buildStep({
      typedData,
      tool,
      approvalAddress: '',
      skipApproval: true,
    }),
    onStepTransaction: (step: LiFiStep) => ({ ...step, typedData }),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C5 — multi-entry signing order and what the consumer is told', () => {
  it('signs a two-entry intent in array order and relays it in that order', async () => {
    const scenario = buildIntentScenario([NONCE_MAPPING, SEND_ASSET])

    await scenario.run()

    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['NonceMapping', 'HyperliquidTransaction:SendAsset'])

    // The signatures are pushed in the same order: the relayed task appends to
    // `signedTypedData` as it iterates `step.typedData`.
    expect(
      scenario
        .events('relayTransaction')[0]
        .typedData.map((entry) => [entry.primaryType, entry.signature])
    ).toEqual([
      ['NonceMapping', WALLET_SIGNATURE],
      ['HyperliquidTransaction:SendAsset', WALLET_SIGNATURE],
    ])
  })

  it('tells the consumer exactly six action updates and eight route updates', async () => {
    const scenario = buildIntentScenario([NONCE_MAPPING, SEND_ASSET])

    await scenario.run()

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
    expect(scenario.events('action')).toHaveLength(6)
    expect(scenario.events('routeUpdate')).toHaveLength(8)

    // Caveat on the absolute numbers: the last `SWAP:PENDING` comes from the
    // real relayed wait task calling `updateActionWithReceipt`, and it fires
    // only because the mocked `waitForRelayedTransactionReceipt` returns a hash
    // that differs from the action's `taskId`. A receipt echoing the taskId
    // would make this 5 and 7. The pipeline-only part of the count is the first
    // four action updates; the equality pinned below is unaffected either way.
  })

  it('signs a three-entry spot-protocol intent in array order', async () => {
    const scenario = buildIntentScenario(
      [APPROVE_BUILDER_FEE, APPROVE_AGENT, AGENT_ORDER],
      'hyperliquidSpotProtocol'
    )

    await scenario.run()

    // `isHyperliquidAgentStep` is true (tool + an `ApproveAgent` entry), so
    // `signHyperliquidTypedData` handles all three. Only the first two reach
    // the wallet; the order is signed by the generated agent account.
    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual([
      'HyperliquidTransaction:ApproveBuilderFee',
      'HyperliquidTransaction:ApproveAgent',
    ])

    const relayed = scenario.events('relayTransaction')[0]
    expect(relayed.typedData.map((entry) => entry.primaryType)).toEqual([
      'HyperliquidTransaction:ApproveBuilderFee',
      'HyperliquidTransaction:ApproveAgent',
      'Agent',
    ])
    expect(relayed.typedData[0].signature).toBe(WALLET_SIGNATURE)
    expect(relayed.typedData[1].signature).toBe(WALLET_SIGNATURE)
    expect(relayed.typedData[2].signature).not.toBe(WALLET_SIGNATURE)

    // The agent address the user approves is the freshly generated one, not
    // the placeholder the quote carried, and the name is stamped with the
    // expiry the SDK chose.
    const approveAgent = scenario.events('signTypedData')[1]
    expect(approveAgent.message.agentAddress).not.toBe(
      APPROVE_AGENT.message.agentAddress
    )
    expect(approveAgent.message.agentName).toMatch(/^lifi valid_until \d+$/)
  })

  it('reports the same counts for three messages as for two', async () => {
    const scenario = buildIntentScenario(
      [APPROVE_BUILDER_FEE, APPROVE_AGENT, AGENT_ORDER],
      'hyperliquidSpotProtocol'
    )

    await scenario.run()

    // Signing is silent: the relayed task raises `MESSAGE_REQUIRED` once and
    // then loops. A consumer cannot tell from the action stream how many
    // prompts the user is about to see, and a progress indicator driven off
    // these counts will not move between signatures.
    expect(scenario.events('action')).toHaveLength(6)
    expect(scenario.events('routeUpdate')).toHaveLength(8)
  })
})
