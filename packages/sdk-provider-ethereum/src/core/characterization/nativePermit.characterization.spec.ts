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
  decodePermit2ProxyCall,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  type Scenario,
  WALLET_SIGNATURE,
} from './harness.js'

/**
 * No typed data, an allowance of zero, an EIP-2612 token, a chain with a
 * Permit2Proxy and a plain EOA signer.
 */
const buildNativePermitScenario = (): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    nativePermitSupported: true,
    accountCode: '0x',
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C6 — a native permit replaces the approval', () => {
  it('signs one EIP-2612 permit naming the Permit2Proxy as spender', async () => {
    const scenario = buildNativePermitScenario()

    await scenario.run()

    const signatures = scenario.events('signTypedData')
    expect(signatures.map((event) => event.primaryType)).toEqual(['Permit'])

    // The permit authorises the **Permit2Proxy** — `EthereumNativePermitTask`
    // passes `fromChain.permit2Proxy` as the spender — and is verified by the
    // token. Canonical Permit2 plays no part in this flow at all.
    expect(signatures[0].message.spender).toBe(LIFI_PERMIT2_PROXY)
    expect(signatures[0].message.spender).not.toBe(CANONICAL_PERMIT2)
    expect(signatures[0].message.owner).toBe(
      scenario.executedStep().action.fromAddress
    )
    expect(signatures[0].message.value).toBe(FROM_AMOUNT)
    expect(signatures[0].domain.verifyingContract).toBe(FROM_TOKEN_ADDRESS)
  })

  it('sends no approval transaction', async () => {
    const scenario = buildNativePermitScenario()

    await scenario.run()

    // The permit sets `hasMatchingPermit`, which is what both allowance-writing
    // tasks gate on, so the allowance is read once and then never acted on.
    const actionTypes = scenario
      .events('action')
      .map((event) => event.actionType)
    expect(actionTypes).toContain('CHECK_ALLOWANCE')
    expect(actionTypes).toContain('NATIVE_PERMIT')
    expect(actionTypes).not.toContain('SET_ALLOWANCE')
    expect(actionTypes).not.toContain('RESET_ALLOWANCE')

    // Exactly one transaction leaves the wallet, and it is not an approval.
    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).not.toBe(FROM_TOKEN_ADDRESS)
  })

  it('sends the swap to the Permit2Proxy with native-permit calldata', async () => {
    const scenario = buildNativePermitScenario()

    await scenario.run()

    const [transaction] = scenario.events('sendTransaction')
    expect(transaction.to).toBe(LIFI_PERMIT2_PROXY)
    // Not the diamond the quote named, and not canonical Permit2.
    expect(transaction.to).not.toBe(APPROVAL_ADDRESS)
    expect(transaction.to).not.toBe(CANONICAL_PERMIT2)

    const call = decodePermit2ProxyCall(transaction.data as Hex)
    expect(call.functionName).toBe('callDiamondWithEIP2612Signature')
    // token, amount, deadline, v, r, s, wrapped diamond calldata.
    expect(call.args[0]).toBe(FROM_TOKEN_ADDRESS)
    expect(call.args[1]).toBe(BigInt(FROM_AMOUNT))
    expect(call.args[6]).toBe(buildTransactionRequest().data)

    // The signature is split by `parseSignature`: `1b` is the recovery id of
    // the harness signature, and r is its first 32 bytes.
    expect(call.args[3]).toBe(27)
    expect(call.args[4]).toBe(WALLET_SIGNATURE.slice(0, 66))
  })
})
