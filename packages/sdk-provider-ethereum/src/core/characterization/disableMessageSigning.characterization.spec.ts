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
  APPROVAL_ADDRESS,
  buildPermitTypedData,
  buildPermitWitnessTypedData,
  buildStep,
  CANONICAL_PERMIT2,
  createScenario,
  decodeApproval,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
} from './harness.js'

/** The same gasless shape as C1, executed with the flag turned on. */
const buildFlaggedScenario = (disableMessageSigning: boolean): Scenario =>
  createScenario({
    step: buildStep({
      typedData: [
        buildPermitTypedData(CANONICAL_PERMIT2),
        buildPermitWitnessTypedData(),
      ],
    }),
    allowance: 0n,
    disableMessageSigning,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C4 — disableMessageSigning on a relayed step', () => {
  it('still asks the wallet to sign every message', async () => {
    const scenario = buildFlaggedScenario(true)

    await scenario.run()

    // PINNED DELIBERATELY, AND IT LOOKS LIKE A BUG.
    //
    // `EthereumRelayedSignAndExecuteTask` never reads `disableMessageSigning`
    // (src/core/tasks/EthereumRelayedSignAndExecuteTask.ts, whole file). The
    // flag is honoured by `EthereumCheckPermitsTask.shouldRun` and
    // `EthereumNativePermitTask.shouldRun`, and by `resolvePermit2Support` —
    // every path that has an approve + execute fallback. A relayed step has
    // none, so the task signs regardless and a caller that set the flag to keep
    // a smart-contract wallet away from EIP-712 gets two signature prompts.
    //
    // This test asserts that the signature IS requested. Do not "fix" it here.
    expect(
      scenario.events('signTypedData').map((event) => event.primaryType)
    ).toEqual(['Permit', 'PermitWitnessTransferFrom'])
    expect(scenario.events('relayTransaction')).toHaveLength(1)
  })

  it('pays for an approval it would not otherwise need', async () => {
    const scenario = buildFlaggedScenario(true)

    await scenario.run()

    // Second consequence of the same flag, also pinned deliberately.
    // `EthereumCheckPermitsTask` is skipped, so `hasMatchingPermit` stays
    // unset and the allowance tasks run. `resolvePermit2Support` returns false
    // because of the flag, so the spender is the diamond rather than canonical
    // Permit2, and the amount is exact rather than unlimited.
    const approvals = scenario.events('sendTransaction')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].to).toBe(FROM_TOKEN_ADDRESS)

    const { spender, amount } = decodeApproval(
      approvals[0].data as `0x${string}`
    )
    expect(spender).toBe(APPROVAL_ADDRESS)
    expect(spender).not.toBe(CANONICAL_PERMIT2)
    expect(spender).not.toBe(LIFI_PERMIT2_PROXY)
    expect(amount).toBe(BigInt(FROM_AMOUNT))

    // The user pays for an approval *and* signs the permit that was supposed
    // to replace it — the permit is still relayed.
    expect(
      scenario.events('relayTransaction')[0].typedData.map((e) => e.primaryType)
    ).toEqual(['Permit', 'PermitWitnessTransferFrom'])
  })

  it('is the only difference: the same step without the flag sends nothing', async () => {
    const scenario = buildFlaggedScenario(false)

    await scenario.run()

    expect(scenario.events('sendTransaction')).toEqual([])
    expect(
      scenario.events('action').map((event) => event.actionType)
    ).not.toContain('SET_ALLOWANCE')
  })
})
