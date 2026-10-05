import { ChainId, executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  buildRoute,
  CCTP_SPENDER,
  destinationTxHashOf,
  envelopeFieldsOf,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  invocationOf,
  NETWORK_PASSPHRASE,
  openPage,
  recordRouteUpdates,
  START_LEDGER,
  STARTING_SEQUENCE,
  STELLAR_EXPLORER_URL,
  sequenceOf,
  signedEnvelopes,
  stepOf,
  USDC_FROM_AMOUNT,
  USDC_TOKEN,
} from './harness.mock.js'

let network: FakeStellarNetwork

beforeEach(() => {
  network = installFakeStellarNetwork()
})

afterEach(() => {
  try {
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Stellar allowance (CCTP bridge leg pulls with transfer_from)', () => {
  it('approves the leg spender, waits for the approval, then quotes, signs and submits the route', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('approvalBridge', page.walletAddress)

    const startedAt = Math.floor(Date.now() / 1000)
    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })
    const finishedAt = Math.floor(Date.now() / 1000)

    // One quote request, for the route's step.
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])

    // Two signatures: the approval the SDK built, then the quoted route.
    const signOptions = {
      address: page.walletAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
    const [approval, routeEnvelope] = page.signTransaction.mock.calls
    expect(page.signTransaction.mock.calls).toHaveLength(2)
    expect(approval[1]).toEqual(signOptions)
    expect(routeEnvelope).toEqual([network.quotes[0], signOptions])
    // The approval's money fields: SAC approve(from, spender, amount,
    // expiration). The amount is the leg's fromAmount plus 10 %; the
    // expiration is the latest ledger plus 17280 ledgers.
    const approveArgs = [
      page.walletAddress,
      CCTP_SPENDER,
      (BigInt(USDC_FROM_AMOUNT) * 110n) / 100n,
      START_LEDGER + 17280,
    ]
    // The ScVal types the SDK gives these arguments (scValToNative drops
    // them: i128 and u128 decode to the same bigint).
    const approveArgTypes = ['scvAddress', 'scvAddress', 'scvI128', 'scvU32']
    expect(invocationOf(approval[0])).toEqual({
      contract: USDC_TOKEN.address,
      method: 'approve',
      args: approveArgs,
    })
    // The node received exactly what the wallet signed, in order.
    const signed = await signedEnvelopes(page)
    expect(network.sent).toEqual(signed)
    expect(signed.map(hashOf)).toEqual([
      hashOf(approval[0]),
      hashOf(network.quotes[0]),
    ])
    // The approval as the wallet signed it: every field the SDK chooses,
    // each argument with its ScVal type. The values were observed on main.
    // - fee: 150, the Soroban inclusion bid (fee stats p70), plus 50000, the
    //   resource fee of the Soroban data that prepareTransaction copied from
    //   the simulation (also pinned below).
    // - timeBounds: setTimeout(300) gives minTime 0 and maxTime 300 s after
    //   the build.
    // - auth: the entry prepareTransaction copied from the simulation. The
    //   source account authorizes exactly this approve call, with no
    //   sub-invocations.
    expect(envelopeFieldsOf(signed[0])).toEqual({
      source: page.walletAddress,
      fee: '50150',
      sequence: String(STARTING_SEQUENCE + 1n),
      preconditions: 'precondTime',
      timeBounds: {
        minTime: 0,
        maxTime: expect.toSatisfy(
          (maxTime: number) =>
            maxTime >= startedAt + 300 && maxTime <= finishedAt + 300,
          'maxTime is 300 s after the build'
        ),
      },
      memo: 'none',
      operations: [
        {
          type: 'invokeHostFunction',
          source: null,
          contract: USDC_TOKEN.address,
          method: 'approve',
          args: approveArgs,
          argTypes: approveArgTypes,
          auth: [
            {
              credentials: 'sorobanCredentialsSourceAccount',
              contract: USDC_TOKEN.address,
              method: 'approve',
              args: approveArgs,
              argTypes: approveArgTypes,
              subInvocations: 0,
            },
          ],
        },
      ],
      sorobanData: {
        resourceFee: 50000n,
        instructions: 0,
        diskReadBytes: 0,
        writeBytes: 0,
        readOnly: [],
        readWrite: [],
        ext: 'v0',
      },
    })
    // The approval used the account's next sequence number, and the route
    // envelope was quoted after the node accepted it (the next one again).
    expect(sequenceOf(approval[0])).toBe(STARTING_SEQUENCE + 1n)
    expect(sequenceOf(network.quotes[0])).toBe(STARTING_SEQUENCE + 2n)
    expect(network.rpcMethods).toEqual([
      // CheckBalanceTask: SAC balance.
      'simulateTransaction',
      // StellarCheckAllowanceTask: SAC allowance (0).
      'simulateTransaction',
      // StellarSetAllowanceTask: buildApproveTransaction reads these three
      // in one Promise.all; the order is the order of the fetch calls.
      'getLedgerEntries',
      'getLatestLedger',
      'getFeeStats',
      // prepareTransaction simulates the approval.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
      // StellarPrepareTransactionTask: assertApprovalStillCovers re-reads
      // the allowance after the re-quote.
      'simulateTransaction',
      // The route transaction.
      'sendTransaction',
      'getTransaction',
    ])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.XLM),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.ARB),
        txHash: hashOf(network.quotes[0]),
        bridge: 'cctp',
      },
    ])

    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])
    const execution = stepOf(executed).execution
    expect(execution?.status).toBe('DONE')
    const approvalHash = hashOf(approval[0])
    const hash = hashOf(network.quotes[0])
    const destinationHash = destinationTxHashOf(hash)
    // StatusManager sorts DONE actions first, in the order they finished.
    expect(execution?.actions).toEqual([
      expect.objectContaining({ type: 'CHECK_ALLOWANCE', status: 'DONE' }),
      expect.objectContaining({
        type: 'SET_ALLOWANCE',
        status: 'DONE',
        txHash: approvalHash,
        txLink: `${STELLAR_EXPLORER_URL}tx/${approvalHash}`,
      }),
      expect.objectContaining({
        type: 'CROSS_CHAIN',
        status: 'DONE',
        txHash: hash,
        txLink: `${STELLAR_EXPLORER_URL}tx/${hash}`,
      }),
      expect.objectContaining({
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: ChainId.ARB,
        txHash: destinationHash,
        txLink: `${ARB_EXPLORER_URL}tx/${destinationHash}`,
      }),
    ])
    expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
  })
})
