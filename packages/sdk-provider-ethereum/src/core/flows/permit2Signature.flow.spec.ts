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
  decodePermit2ProxyCall,
  FROM_ADDRESS,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  LIFI_PERMIT2_PROXY,
  PERMIT2_PROXY_NONCE,
  type Scenario,
  WALLET_SIGNATURE,
} from './harness.mock.js'

/**
 * No typed data, an allowance of zero, a token with **no** EIP-2612 support, a
 * Permit2 chain and an EOA — so `canAccountUsePermit2` answers from the empty
 * account code and the ERC-1271 probe is never needed.
 */
const buildPermit2Scenario = (): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    nativePermitSupported: false,
    accountCode: '0x',
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C7 — the SDK produces the Permit2 signature itself', () => {
  it('approves canonical Permit2 for the unlimited amount', async () => {
    const scenario = buildPermit2Scenario()

    await scenario.run()

    const approvals = scenario
      .events('sendTransaction')
      .filter((event) => event.to === FROM_TOKEN_ADDRESS)
    expect(approvals).toHaveLength(1)

    const { spender, amount } = decodeApproval(approvals[0].data as Hex)
    // Canonical Permit2 — NOT the Permit2Proxy the transaction is later sent
    // to, and not the diamond the quote named as `approvalAddress`. Both
    // guards are fixture-drift guards on addresses that must stay distinct.
    expect(spender).toBe(CANONICAL_PERMIT2)
    expect(spender).not.toBe(LIFI_PERMIT2_PROXY)
    expect(spender).not.toBe(APPROVAL_ADDRESS)
    // Unlimited, because Permit2 re-authorises each transfer by signature.
    expect(amount).toBe(MaxUint256)

    // The allowance is *read* against the same spender it is later written to:
    // `EthereumCheckAllowanceTask.ts:31-33` picks `fromChain.permit2` once
    // `resolvePermit2Support` says yes. Pinned separately from the write,
    // because the harness answers every `allowance` read with the same number,
    // so nothing else in this lane can tell which contract was asked about.
    const allowanceReads = scenario
      .events('readContract')
      .filter((event) => event.functionName === 'allowance')
    expect(allowanceReads).toHaveLength(1)
    expect(allowanceReads[0].address).toBe(FROM_TOKEN_ADDRESS)
    expect(allowanceReads[0].args[0]).toBe(FROM_ADDRESS)
    expect(allowanceReads[0].args[1]).toBe(CANONICAL_PERMIT2)
    expect(allowanceReads[0].args[1]).not.toBe(LIFI_PERMIT2_PROXY)
    expect(allowanceReads[0].args[1]).not.toBe(APPROVAL_ADDRESS)
  })

  it('signs a Permit2 message for the proxy, verified by canonical Permit2', async () => {
    const scenario = buildPermit2Scenario()

    await scenario.run()

    const signatures = scenario.events('signTypedData')
    // `EthereumStandardSignAndExecuteTask` calls `signPermit2Message` without
    // a witness, so the primary type is the plain `PermitTransferFrom` — not
    // the `PermitWitnessTransferFrom` the gasless relayer flow uses.
    expect(signatures.map((event) => event.primaryType)).toEqual([
      'PermitTransferFrom',
    ])
    expect(signatures[0].message.spender).toBe(LIFI_PERMIT2_PROXY)
    expect(signatures[0].domain.verifyingContract).toBe(CANONICAL_PERMIT2)

    // The nonce comes from the proxy's `nextNonce`, read off the proxy.
    const nonceRead = scenario
      .events('readContract')
      .find((event) => event.functionName === 'nextNonce')
    expect(nonceRead?.address).toBe(LIFI_PERMIT2_PROXY)
    expect(signatures[0].message.nonce).toBe(PERMIT2_PROXY_NONCE)
  })

  it('sends the swap to the Permit2Proxy wrapped in callDiamondWithPermit2', async () => {
    const scenario = buildPermit2Scenario()

    await scenario.run()

    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(2)
    const [, swap] = sent
    // The proxy, not the diamond the quote named — the retarget is the claim.
    expect(swap.to).toBe(LIFI_PERMIT2_PROXY)
    expect(swap.to).not.toBe(APPROVAL_ADDRESS)

    const call = decodePermit2ProxyCall(swap.data as Hex)
    expect(call.functionName).toBe('callDiamondWithPermit2')
    // diamond calldata, ((token, amount), nonce, deadline), signature
    expect(call.args[0]).toBe(buildTransactionRequest().data)
    const permit = call.args[1] as [[string, bigint], bigint, bigint]
    expect(permit[0][0]).toBe(FROM_TOKEN_ADDRESS)
    expect(permit[0][1]).toBe(BigInt(FROM_AMOUNT))
    expect(permit[1]).toBe(PERMIT2_PROXY_NONCE)
    expect(call.args[2]).toBe(WALLET_SIGNATURE)
  })

  it('walks the SWAP action back from MESSAGE_REQUIRED to ACTION_REQUIRED', async () => {
    const scenario = buildPermit2Scenario()

    await scenario.run()

    // Pinned as observed. `EthereumStandardSignAndExecuteTask` raises
    // MESSAGE_REQUIRED for the Permit2 signature and then ACTION_REQUIRED again
    // for the transaction, so a consumer sees the swap step go "backwards".
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:STARTED',
      'NATIVE_PERMIT:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
    ])

    // Fourteen calls, four actions. The array a consumer renders never shows
    // the walk backwards as a new entry — `SWAP` is mutated in place — and the
    // headline the widget reads at the signature prompt is the swap's, not the
    // finished allowance's, even though three DONE entries sit in front of it.
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
    ])
    expect(scenario.events('signTypedData')[0].actions.at(-1)).toBe(
      'SWAP:MESSAGE_REQUIRED'
    )
    expect(
      scenario.events('sendTransaction').map((event) => event.actions.at(-1))
    ).toEqual(['SET_ALLOWANCE:ACTION_REQUIRED', 'SWAP:ACTION_REQUIRED'])

    // `NATIVE_PERMIT` is announced to the consumer and then completed without
    // anything happening: the task starts, discovers the token has no EIP-2612
    // support, and reports DONE. It also costs 14 contract reads to find that
    // out, because `getActionWithFallback` retries every failed read on the
    // public client.
    expect(
      scenario
        .events('readContract')
        .filter(
          (e) =>
            e.functionName !== 'allowance' && e.functionName !== 'nextNonce'
        )
    ).toHaveLength(14)
  })
})
