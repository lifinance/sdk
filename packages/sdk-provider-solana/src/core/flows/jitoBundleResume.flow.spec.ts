import { executeRoute, type RouteExtended, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTestKeypair } from '../../utils/KeypairWallet.unit.helpers.js'
import {
  apiTrail,
  buildRoute,
  createFakeNetwork,
  createFakeWallet,
  type FakeNetwork,
  openPage,
  type PageOptions,
  persist,
  RECEIVED_SWAP_AMOUNT,
  recordRoute,
  SOLANA_EXPLORER,
  sentTransactions,
  signatureOf,
  submitTrail,
} from './harness.mock.js'

// The Jito bundle variants of the #507 reload specs
// (`reload.unit.spec.ts` covers the single transaction). A reload is a new
// page - a new wallet object with the same key, a new provider and a new
// client - that resumes what storage held. The module caches (RPC clients,
// Jito probe answers) survive it, as they do in these specs generally, so
// the resume does not probe the RPCs again.

let network: FakeNetwork
let secretKey: string

beforeEach(async () => {
  network = createFakeNetwork({ read: 'standard', jito: 'jito' })
  vi.stubGlobal('fetch', network.fetch)
  secretKey = (await generateTestKeypair()).secretKey
})

afterEach(() => {
  try {
    expect(network.unknown).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

const pageOptions = (): PageOptions => ({
  rpcUrls: [network.url('read'), network.url('jito')],
  routeOptions: { jitoBundle: true },
})

const swapOf = (route: RouteExtended) =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

/** The params of every `getSignatureStatuses` request, in order. */
const statusLookups = (): unknown[][] =>
  network.rpcCalls
    .filter((call) => call.method === 'getSignatureStatuses')
    .map((call) => call.params)

describe('Solana Jito bundle resume (#507)', () => {
  it('resubmits the stored bundle after a reload between signing and the send, without a new signature', async () => {
    const firstWallet = await createFakeWallet(secretKey)
    const recorder = recordRoute()
    // The page dies when the bundle leaves the SDK: storage holds the last
    // snapshot `updateRouteHook` wrote before that instant.
    let atSend: RouteExtended | undefined
    let firstSent: string[] | undefined
    network.onSend = (wires, call) => {
      if (call.method === 'sendBundle' && !atSend) {
        atSend = recorder.latest()
        firstSent = wires
      }
    }
    await executeRoute(
      openPage(firstWallet, pageOptions()),
      buildRoute(network, firstWallet.address),
      { updateRouteHook: recorder.updateRouteHook }
    )
    // One wallet request with the exact quoted bundle; the bundle that left
    // the SDK is exactly what the wallet returned.
    expect(firstWallet.signCalls).toHaveLength(1)
    expect(firstWallet.signCalls[0]).toMatchObject({
      inputs: network.quotes[0],
      rejected: false,
    })
    expect(firstSent).toEqual(firstWallet.signCalls[0].outputs)
    // #507 behaviour: the signed bundle is stored as a JSON array before the
    // send, and no txHash exists yet.
    expect(swapOf(atSend!)?.txHex).toBe(JSON.stringify(firstSent))
    expect(swapOf(atSend!)?.txHash).toBeUndefined()

    // Nothing reached a node.
    network.onSend = undefined
    network.forgetChain()
    network.clearRecords()
    const reloadedWallet = await createFakeWallet(secretKey)
    const resume = recordRoute()
    const resumed = await resumeRoute(
      openPage(reloadedWallet, pageOptions()),
      atSend!,
      { updateRouteHook: resume.updateRouteHook }
    )

    // #507 behaviour: the SDK sends the same signed bytes; the wallet is not
    // opened and no new quote is fetched.
    expect(reloadedWallet.signCalls).toEqual([])
    expect(firstWallet.signCalls).toHaveLength(1)
    expect(apiTrail(network)).toEqual(['GET /chains', 'GET /status'])
    const txHash = signatureOf(firstSent![0])
    // #507 behaviour: one target-only lookup of the first signature on every
    // RPC finds no confirmed status; the SDK resends on any answer that is not
    // confirmed, so the stored bytes go out once, as a bundle, exactly as
    // signed and without simulation; nothing goes out one by one.
    // The warm module caches skip the Jito probes (see the header). A real
    // reload starts with cold caches, so `getBundleStatuses@read` and
    // `getBundleStatuses@jito` would come before `sendBundle@jito`.
    expect(submitTrail(network)).toEqual([
      'getSignatureStatuses@read',
      'getSignatureStatuses@jito',
      'sendBundle@jito',
      'getBundleStatuses@jito',
      'getSignatureStatuses@jito',
    ])
    expect(statusLookups().slice(0, 2)).toEqual([
      [[txHash], { searchTransactionHistory: true }],
      [[txHash], { searchTransactionHistory: true }],
    ])
    expect(sentTransactions(network, 'sendBundle')).toEqual(firstSent)
    expect(sentTransactions(network)).toEqual([])
    expect(network.apiCalls.at(-1)?.query.txHash).toBe(txHash)

    expect(resume.trail()).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expect(resumed.steps[0].execution).toMatchObject({
      status: 'DONE',
      toAmount: RECEIVED_SWAP_AMOUNT,
      actions: [
        {
          type: 'SWAP',
          status: 'DONE',
          // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
          txHash,
          txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
        },
      ],
    })
  })

  it('waits for the submitted bundle after a reload, without a new signature or a new send', async () => {
    const firstWallet = await createFakeWallet(secretKey)
    const recorder = recordRoute()
    await executeRoute(
      openPage(firstWallet, pageOptions()),
      buildRoute(network, firstWallet.address),
      { updateRouteHook: recorder.updateRouteHook }
    )
    expect(firstWallet.signCalls).toHaveLength(1)
    expect(firstWallet.signCalls[0]).toMatchObject({
      inputs: network.quotes[0],
      rejected: false,
    })
    const signed = firstWallet.signCalls[0].outputs
    expect(sentTransactions(network, 'sendBundle')).toEqual(signed)
    const txHash = signatureOf(signed[0])
    // What storage held right after Jito accepted the bundle.
    const afterSend = recorder.snapshots.find((snapshot) => {
      const swap = swapOf(snapshot)
      return swap?.txHash && swap.status !== 'DONE'
    })
    expect(afterSend).toBeDefined()
    // #507 behaviour: the accepted send writes the first signature, and the
    // stored bundle stays until the confirmation.
    expect(swapOf(afterSend!)?.txHash).toBe(txHash)
    expect(swapOf(afterSend!)?.txHex).toBe(JSON.stringify(signed))

    // The bundle landed; the chain keeps it.
    network.clearRecords()
    const reloadedWallet = await createFakeWallet(secretKey)
    const resume = recordRoute()
    const resumed = await resumeRoute(
      openPage(reloadedWallet, pageOptions()),
      persist(afterSend!),
      { updateRouteHook: resume.updateRouteHook }
    )

    // #507 behaviour: the SDK waits for the first transaction; the wallet is
    // not opened and no new quote is fetched.
    expect(reloadedWallet.signCalls).toEqual([])
    expect(firstWallet.signCalls).toHaveLength(1)
    expect(apiTrail(network)).toEqual(['GET /chains', 'GET /status'])
    // #507 behaviour: the lookup finds the first signature confirmed, so
    // nothing is sent.
    expect(submitTrail(network)).toEqual([
      'getSignatureStatuses@read',
      'getSignatureStatuses@jito',
    ])
    expect(statusLookups()).toEqual([
      [[txHash], { searchTransactionHistory: true }],
      [[txHash], { searchTransactionHistory: true }],
    ])
    expect(sentTransactions(network, 'sendBundle')).toEqual([])
    expect(sentTransactions(network)).toEqual([])
    expect(network.apiCalls.at(-1)?.query.txHash).toBe(txHash)

    expect(resume.trail()).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expect(resumed.steps[0].execution).toMatchObject({
      status: 'DONE',
      toAmount: RECEIVED_SWAP_AMOUNT,
      actions: [
        {
          type: 'SWAP',
          status: 'DONE',
          // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
          txHash,
          txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
        },
      ],
    })
  })
})
