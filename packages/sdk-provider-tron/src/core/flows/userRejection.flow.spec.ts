import { executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  openPage,
  quotedCallOf,
  recordRoute,
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

describe('Tron user rejection', () => {
  it('fails the swap with SignatureRejected, sends nothing, and "Try again" asks the wallet again', async () => {
    const page = openPage()
    const recorder = recordRoute()
    page.wallet.rejectNext()

    await expect(
      executeRoute(page.client, buildRoute(buildStep('trx-swap')), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })

    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.signed).toEqual([])
    expect(network.broadcasts).toEqual([])
    expect(network.apiCalls).toEqual([])
    expect(recorder.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:FAILED',
    ])
    const failed = recorder.last()
    expect(failed.steps[0].execution?.status).toBe('FAILED')
    expect(actionOf(failed, 'SWAP')).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(actionOf(failed, 'SWAP')?.txHash).toBeUndefined()

    // "Try again": the widget resumes the stored route on the same page.
    const retry = recordRoute()
    const retried = await resumeRoute(page.client, failed, {
      updateRouteHook: retry.updateRouteHook,
    })

    // `prepareRestart` drops the actions and the transaction request, so the
    // retry re-quotes and the wallet is asked again, for the new quote.
    expect(network.apiCalls).toEqual([
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(page.wallet.requests).toHaveLength(2)
    expect(
      page.wallet.requests[1].raw_data.contract[0].parameter.value
    ).toMatchObject({
      data: quotedCallOf(
        network.requotes[0].transactionRequest?.data
      ).data.toUpperCase(),
    })
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(retry.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const swapHash = page.wallet.signed[0].txID
    expect(retried.steps[0].execution?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(retried, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
  })

  it('fails the approval with SignatureRejected, sends nothing, and "Try again" asks for the approval again', async () => {
    const page = openPage()
    const recorder = recordRoute()
    page.wallet.rejectNext()

    await expect(
      executeRoute(page.client, buildRoute(buildStep('trc20-swap')), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })

    expect(page.wallet.requests).toHaveLength(1)
    expect(network.broadcasts).toEqual([])
    expect(network.apiCalls).toEqual([])
    expect(recorder.transitions()).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:FAILED',
    ])
    const failed = recorder.last()
    expect(failed.steps[0].execution?.status).toBe('FAILED')
    expect(actionOf(failed, 'SET_ALLOWANCE')).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(actionOf(failed, 'SWAP')).toBeUndefined()

    const retry = recordRoute()
    const retried = await resumeRoute(page.client, failed, {
      updateRouteHook: retry.updateRouteHook,
    })

    // The retry reads the allowance again (still 0), asks for the approval,
    // then for the swap. The swap needs a new quote: `prepareRestart` dropped
    // the transaction request.
    expect(network.apiCalls).toEqual([
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(page.wallet.requests).toHaveLength(3)
    // The node builds the approve again: `approve(diamond, fromAmount)` on
    // USDT, as in the rejected request. The two requests also have the same
    // bytes and txID, only because the fake head block never moves.
    expect(
      network.nodeCalls.filter((call) =>
        call.startsWith('wallet/triggersmartcontract')
      )
    ).toEqual([
      'wallet/triggersmartcontract approve(address,uint256)',
      'wallet/triggersmartcontract approve(address,uint256)',
    ])
    const approveCall = {
      data: '095ea7b3000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000001e8480',
      owner_address: '41fcad0b19bb29d4674531d6f115237e16afce377c',
      contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    }
    expect(
      page.wallet.requests.map(
        (request) => request.raw_data.contract[0].parameter.value
      )
    ).toMatchObject([
      approveCall,
      approveCall,
      {
        data: quotedCallOf(
          network.requotes[0].transactionRequest?.data
        ).data.toUpperCase(),
      },
    ])
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(page.wallet.signed).toHaveLength(2)
    expect(retry.transitions()).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const [approveHash, swapHash] = page.wallet.signed.map((tx) => tx.txID)
    expect(retried.steps[0].execution?.status).toBe('DONE')
    // The approval link is the provider's own (`getTronTxLink`, no `/`
    // before `#`); `/status` never sees the approval.
    expect(actionOf(retried, 'SET_ALLOWANCE')).toMatchObject({
      status: 'DONE',
      txHash: approveHash,
      txLink: `https://tronscan.test#/transaction/${approveHash}`,
    })
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(retried, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
  })
})
