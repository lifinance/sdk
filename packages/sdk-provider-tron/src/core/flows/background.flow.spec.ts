import { executeRoute, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  LIFI_DIAMOND,
  openPage,
  quotedCallOf,
  recordRoute,
  USDT,
  WALLET_ADDRESS,
} from './harness.mock.js'

let network: FakeTronNetwork

beforeEach(() => {
  network = installFakeTronNetwork()
})

afterEach(() => {
  try {
    // A request no fake implements, or a throw inside a fake, turns into an
    // RPC error and can let a path pass for the wrong reason.
    expect(network.unknown, 'requests no fake implements').toEqual([])
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

/** The TAPOS fields every transaction gets from the fake head block. */
const HEAD_REF_BLOCK = {
  ref_block_bytes: '1d80',
  ref_block_hash: 'abababababababab',
  expiration: 1_760_000_060_000,
  timestamp: 1_760_000_000_000,
}

/**
 * The `raw_data` the wallet gets for a quoted swap: the quoted call,
 * re-anchored to the head block and re-encoded by TronWeb (upper-case hex,
 * zero token fields).
 */
const swapRawData = (transactionRequestData: unknown, callValue: number) => ({
  contract: [
    {
      parameter: {
        value: {
          owner_address: '41FCAD0B19BB29D4674531D6F115237E16AFCE377C',
          contract_address: '412222222222222222222222222222222222222222',
          call_value: callValue,
          data: quotedCallOf(transactionRequestData).data.toUpperCase(),
          call_token_value: 0,
          token_id: 0,
        },
        type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
      },
      type: 'TriggerSmartContract',
    },
  ],
  fee_limit: 150_000_000,
  data: '',
  ...HEAD_REF_BLOCK,
})

/**
 * `approve(diamond, fromAmount)` on USDT, as the node builds it, with the
 * default 100 TRX fee limit (the quote has no APPROVE gas cost).
 */
const approveRawData = {
  contract: [
    {
      parameter: {
        value: {
          data: '095ea7b3000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000001e8480',
          owner_address: '41fcad0b19bb29d4674531d6f115237e16afce377c',
          contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        },
        type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
      },
      type: 'TriggerSmartContract',
    },
  ],
  ...HEAD_REF_BLOCK,
  fee_limit: 100_000_000,
}

describe('Tron background execution', () => {
  it('pauses a TRX swap in PrepareTransactionTask without the wallet; a foreground resume signs once and completes', async () => {
    const page = openPage()
    const recorder = recordRoute()

    // A pause is not an error: the promise resolves.
    await expect(
      executeRoute(page.client, buildRoute(buildStep('trx-swap')), {
        updateRouteHook: recorder.updateRouteHook,
        executeInBackground: true,
      })
    ).resolves.toBeDefined()

    // Pinned as observed: main pauses in core `PrepareTransactionTask`, before
    // `TronSignAndExecuteTask` reads the ref block, so the Tron sign task's
    // own gate is never reached. Only the balance was read.
    expect(page.wallet.requests).toEqual([])
    expect(network.broadcasts).toEqual([])
    expect(network.apiCalls).toEqual([])
    expect(network.nodeCalls).toEqual([
      'walletsolidity/getaccount',
      'wallet/getnowblock',
    ])
    expect(recorder.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
    ])
    const paused = recorder.last()
    expect(paused.steps[0].execution?.status).toBe('ACTION_REQUIRED')
    expect(actionOf(paused, 'SWAP')?.txHash).toBeUndefined()

    // The user opens the route: a foreground resume of the stored route.
    const resume = recordRoute()
    const resumed = await resumeRoute(page.client, paused, {
      updateRouteHook: resume.updateRouteHook,
    })

    // `prepareRestart` cleared the transaction request, so the resume
    // re-quotes before it signs, and the wallet signs the new quote.
    expect(network.apiCalls).toEqual([
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.requests[0].raw_data).toEqual(
      swapRawData(network.requotes[0].transactionRequest?.data, 1_000_000)
    )
    // One broadcast, byte for byte what the wallet signed.
    expect(page.wallet.signed).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    // The resume reads the balance again, then the ref block, broadcasts and
    // reads the receipt once.
    expect(network.nodeCalls).toEqual([
      'walletsolidity/getaccount',
      'wallet/getnowblock',
      'walletsolidity/getaccount',
      'wallet/getnowblock',
      'wallet/getblock',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
    ])
    expect(resume.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const swapHash = page.wallet.signed[0].txID
    expect(resumed.steps[0].execution?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(resumed, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
  })

  it('signs and sends the TRC-20 approval in the background, then pauses before the swap', async () => {
    const page = openPage()
    const recorder = recordRoute()

    await expect(
      executeRoute(page.client, buildRoute(buildStep('trc20-swap')), {
        updateRouteHook: recorder.updateRouteHook,
        executeInBackground: true,
      })
    ).resolves.toBeDefined()

    // Pinned as observed, and it looks wrong (Finding 1):
    // `TronSetAllowanceTask` has no `allowUserInteraction` gate, so a
    // background run asks the wallet for the approval and broadcasts it.
    // Only the swap pauses (core `PrepareTransactionTask`).
    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.requests[0].raw_data).toEqual(approveRawData)
    expect(page.wallet.signed).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(network.allowance(USDT.address, WALLET_ADDRESS, LIFI_DIAMOND)).toBe(
      2_000_000n
    )
    expect(network.apiCalls).toEqual([])
    // The background run builds, sends and confirms the approval, reads the
    // balance, and stops before the ref block read of the swap.
    expect(network.nodeCalls).toEqual([
      'wallet/getcontract',
      'wallet/triggerconstantcontract allowance(address,address)',
      'wallet/triggersmartcontract approve(address,uint256)',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
      'wallet/getcontract',
      'wallet/getnowblock',
      'wallet/triggerconstantcontract balanceOf(address)',
    ])
    expect(recorder.transitions()).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
    ])
    const approveHash = page.wallet.signed[0].txID
    const paused = recorder.last()
    expect(paused.steps[0].execution?.status).toBe('ACTION_REQUIRED')
    expect(actionOf(paused, 'SET_ALLOWANCE')).toMatchObject({
      status: 'DONE',
      txHash: approveHash,
      txLink: `https://tronscan.test#/transaction/${approveHash}`,
    })
    expect(actionOf(paused, 'SWAP')?.txHash).toBeUndefined()

    const resume = recordRoute()
    const resumed = await resumeRoute(page.client, paused, {
      updateRouteHook: resume.updateRouteHook,
    })

    // The resume drops every action (no SWAP hash yet), reads the allowance
    // again, finds the approval on chain and signs only the swap, for a new
    // quote. The node builds no second approval.
    expect(network.apiCalls).toEqual([
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(page.wallet.requests).toHaveLength(2)
    expect(page.wallet.requests[1].raw_data).toEqual(
      swapRawData(network.requotes[0].transactionRequest?.data, 0)
    )
    expect(page.wallet.signed).toHaveLength(2)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(
      network.nodeCalls.filter((call) =>
        call.startsWith('wallet/triggersmartcontract')
      )
    ).toEqual(['wallet/triggersmartcontract approve(address,uint256)'])
    expect(resume.transitions()).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const swapHash = page.wallet.signed[1].txID
    expect(resumed.steps[0].execution?.status).toBe('DONE')
    // The resumed route no longer records the approval: `prepareRestart`
    // dropped its action and the allowance check skips the approval.
    expect(actionOf(resumed, 'SET_ALLOWANCE')).toBeUndefined()
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(resumed, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
  })
})
