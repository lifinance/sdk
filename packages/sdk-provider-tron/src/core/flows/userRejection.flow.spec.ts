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

describe('Tron user rejection', () => {
  it('fails the swap with SignatureRejected, sends nothing, and "Try again" asks the wallet again', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('trx-swap')
    page.wallet.rejectNext()

    await expect(
      executeRoute(page.client, buildRoute(step), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })

    // The wallet was asked to sign the original quote, with the 1 TRX value.
    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.requests[0].raw_data).toEqual(
      swapRawData(step.transactionRequest?.data, 1_000_000)
    )
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
    expect(page.wallet.requests[1].raw_data).toEqual(
      swapRawData(network.requotes[0].transactionRequest?.data, 1_000_000)
    )
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
    // `approve(diamond, fromAmount)` on USDT with the default 100 TRX fee
    // limit (the quote has no APPROVE gas cost).
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
    const [rejectedApprove, approve, swap] = page.wallet.requests
    expect(rejectedApprove.raw_data).toEqual(approveRawData)
    expect(approve.raw_data).toEqual(approveRawData)
    // The swap signs the new quote (no TRX value).
    expect(swap.raw_data).toEqual(
      swapRawData(network.requotes[0].transactionRequest?.data, 0)
    )
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
