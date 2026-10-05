import { ChainId, executeRoute } from '@lifi/sdk'
import {
  Address,
  type Operation,
  scValToNative,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  buildRoute,
  CCTP_SPENDER,
  destinationTxHashOf,
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

/**
 * The auth entries of the one operation of an envelope, decoded from its
 * XDR: the credentials, the authorized contract call and the number of
 * sub-invocations.
 */
const authEntriesOf = (envelope: string) => {
  const transaction = TransactionBuilder.fromXDR(
    envelope,
    NETWORK_PASSPHRASE
  ) as Transaction
  const [operation] = transaction.operations as Operation.InvokeHostFunction[]
  return (operation.auth ?? []).map(({ credentials, rootInvocation }) => {
    const authorized = rootInvocation.function
    if (authorized.type !== 'sorobanAuthorizedFunctionTypeContractFn') {
      return { credentials: credentials.type, function: authorized.type }
    }
    const call = authorized.contractFn
    return {
      credentials: credentials.type,
      contract: Address.fromScAddress(call.contractAddress).toString(),
      method: call.functionName.toString(),
      args: call.args.map((arg) => scValToNative(arg)),
      subInvocations: rootInvocation.subInvocations.length,
    }
  })
}

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

    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })

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
    // The signed approval carries the auth entry that prepareTransaction
    // copied from the simulation: the source account authorizes exactly
    // this approve call, with no sub-invocations.
    expect(authEntriesOf(signed[0])).toEqual([
      {
        credentials: 'sorobanCredentialsSourceAccount',
        contract: USDC_TOKEN.address,
        method: 'approve',
        args: approveArgs,
        subInvocations: 0,
      },
    ])
    // The approval used the account's next sequence number, and the route
    // envelope was quoted after it landed (the next one again).
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
