import { ChainId, executeRoute, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  actionOf,
  BRIDGE_RECEIVED_AMOUNT,
  buildRoute,
  CCTP_SPENDER,
  destinationTxHashOf,
  envelopeFieldsOf,
  envelopesToSign,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  NETWORK_PASSPHRASE,
  openPage,
  recordRouteUpdates,
  START_LEDGER,
  STARTING_SEQUENCE,
  STATUS_EXPLORER_URL,
  STELLAR_EXPLORER_URL,
  SWAP_RECEIVED_AMOUNT,
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
    // A call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Stellar background execution', () => {
  it('pauses in PrepareTransactionTask after the quote, then a foreground resume signs once and completes', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)
    const signOptions = {
      address: page.walletAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    }

    const paused = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
      executeInBackground: true,
    })

    // main: StellarSignAndExecuteTask has no allowUserInteraction check.
    // The run pauses earlier, in core PrepareTransactionTask, right after
    // it fetched the step transaction.
    expect(page.signTransaction).not.toHaveBeenCalled()
    expect(network.sent).toEqual([])
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    expect(network.quotes).toHaveLength(1)
    // CheckBalanceTask: SAC balance.
    expect(network.rpcMethods).toEqual(['simulateTransaction'])
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual(['SWAP:STARTED', 'SWAP:ACTION_REQUIRED'])
    // Where main pauses: the swap waits for a signature, and the step holds
    // the quote it fetched. (On main, resumeRoute changes the route it
    // gets, so these pins come first.)
    expect(stepOf(paused).execution?.status).toBe('ACTION_REQUIRED')
    expect(stepOf(paused).execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'ACTION_REQUIRED',
        chainId: ChainId.XLM,
      }),
    ])
    expect(actionOf(paused, 'SWAP')?.status).toBe('ACTION_REQUIRED')
    expect(actionOf(paused, 'SWAP')?.txHash).toBeUndefined()
    expect(stepOf(paused).transactionRequest?.data).toBe(network.quotes[0])

    const foreground = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, paused, {
      updateRouteHook: foreground.hook,
    })

    // main: the pause stopped the route, so resumeRoute runs core
    // prepareRestart, which drops the stored transactionRequest (and
    // StellarPrepareTransactionTask always re-fetches). The resume quotes
    // again and signs only the new quote, once; the background quote is
    // never signed. A paused background run costs one quote request that
    // is never used (characterized).
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
      route.steps[0].id,
    ])
    expect(network.quotes).toHaveLength(2)
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[1], signOptions],
    ])
    expect(envelopesToSign(page)).toEqual([network.quotes[1]])
    // The node received exactly the envelope the wallet signed, once.
    const signed = await signedEnvelopes(page)
    expect(network.sent).toEqual(signed)
    const hash = hashOf(network.quotes[1])
    expect(signed.map(hashOf)).toEqual([hash])
    expect(network.rpcMethods).toEqual([
      // The background run: CheckBalanceTask (SAC balance).
      'simulateTransaction',
      // The resume: CheckBalanceTask again, then the submission.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.XLM),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.XLM),
        txHash: hash,
        bridge: 'soroswap',
      },
    ])
    expect(foreground.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    const execution = stepOf(resumed).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        chainId: ChainId.XLM,
        txHash: hash,
        txLink: `${STATUS_EXPLORER_URL}tx/${hash}`,
      }),
    ])
    expect(actionOf(resumed, 'SWAP')?.txHash).toBe(hash)
    expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
  })

  it('pauses in StellarSetAllowanceTask before the approval, then a foreground resume approves, signs and completes', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('approvalBridge', page.walletAddress)
    const signOptions = {
      address: page.walletAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    }

    const paused = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
      executeInBackground: true,
    })

    // main: the allowance task checks allowUserInteraction itself, before
    // it builds the approval: no account read, no quote, no wallet call.
    expect(page.signTransaction).not.toHaveBeenCalled()
    expect(network.sent).toEqual([])
    expect(network.stepTransactionRequests).toEqual([])
    expect(network.quotes).toEqual([])
    expect(network.rpcMethods).toEqual([
      // CheckBalanceTask: SAC balance.
      'simulateTransaction',
      // StellarCheckAllowanceTask: SAC allowance (0).
      'simulateTransaction',
    ])
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
    ])
    // Where main pauses: the approval waits for the user, and the bridge
    // action has only started. (On main, resumeRoute changes the route it
    // gets, so these pins come first.)
    expect(stepOf(paused).execution?.status).toBe('ACTION_REQUIRED')
    expect(stepOf(paused).execution?.actions).toEqual([
      expect.objectContaining({ type: 'CHECK_ALLOWANCE', status: 'DONE' }),
      expect.objectContaining({ type: 'CROSS_CHAIN', status: 'STARTED' }),
      expect.objectContaining({
        type: 'SET_ALLOWANCE',
        status: 'ACTION_REQUIRED',
      }),
    ])
    expect(actionOf(paused, 'SET_ALLOWANCE')?.status).toBe('ACTION_REQUIRED')
    expect(actionOf(paused, 'SET_ALLOWANCE')?.txHash).toBeUndefined()
    expect(stepOf(paused).transactionRequest).toBeUndefined()

    const foreground = recordRouteUpdates()
    const startedAt = Math.floor(Date.now() / 1000)
    const resumed = await resumeRoute(page.client, paused, {
      updateRouteHook: foreground.hook,
    })
    const finishedAt = Math.floor(Date.now() / 1000)

    // The foreground run starts over (no action had a hash): the approval,
    // then the route, one signature each.
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    expect(page.signTransaction).toHaveBeenCalledTimes(2)
    // The approval is pinned field by field below.
    const [approval] = envelopesToSign(page)
    expect(page.signTransaction.mock.calls).toEqual([
      [approval, signOptions],
      [network.quotes[0], signOptions],
    ])
    expect(envelopesToSign(page)[1]).toBe(network.quotes[0])
    // The approval the wallet signed: every field the SDK chooses, each
    // argument with its ScVal type. The values were observed on main, and
    // they are the values of the foreground allowance flow.
    // - args: SAC approve(from, spender, amount, expiration). The amount is
    //   the leg's fromAmount plus 10 %; the expiration is the latest ledger
    //   plus 17280 ledgers.
    // - fee: 150, the Soroban inclusion bid (fee stats p70), plus 50000, the
    //   resource fee of the Soroban data that prepareTransaction copied from
    //   the simulation (also pinned below).
    // - sequence: the account's next one. The background run sent nothing.
    // - timeBounds: setTimeout(300) gives minTime 0 and maxTime 300 s after
    //   the build, which the resume does.
    // - auth: the entry prepareTransaction copied from the simulation. The
    //   source account authorizes exactly this approve call, with no
    //   sub-invocations.
    const approveArgs = [
      page.walletAddress,
      CCTP_SPENDER,
      (BigInt(USDC_FROM_AMOUNT) * 110n) / 100n,
      START_LEDGER + 17280,
    ]
    const approveArgTypes = ['scvAddress', 'scvAddress', 'scvI128', 'scvU32']
    expect(envelopeFieldsOf(approval)).toEqual({
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
    // The node received exactly what the wallet signed, in order. The hash
    // covers every field above, so the approval sent is the approval pinned.
    const signed = await signedEnvelopes(page)
    expect(network.sent).toEqual(signed)
    expect(signed.map(hashOf)).toEqual([
      hashOf(approval),
      hashOf(network.quotes[0]),
    ])
    // The route envelope was quoted after the node accepted the approval.
    expect(sequenceOf(network.quotes[0])).toBe(STARTING_SEQUENCE + 2n)
    expect(network.rpcMethods).toEqual([
      // The background run: CheckBalanceTask (SAC balance), then
      // StellarCheckAllowanceTask (SAC allowance, 0).
      'simulateTransaction',
      'simulateTransaction',
      // The resume: both reads again.
      'simulateTransaction',
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
      // the allowance after the quote.
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
    expect(foreground.changes).toEqual([
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
    const execution = stepOf(resumed).execution
    expect(execution?.status).toBe('DONE')
    const approvalHash = hashOf(approval)
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
    expect(actionOf(resumed, 'CROSS_CHAIN')?.txHash).toBe(hash)
    expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
  })
})
