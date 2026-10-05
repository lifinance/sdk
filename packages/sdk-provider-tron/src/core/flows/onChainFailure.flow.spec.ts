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
 * The `raw_data` the wallet gets for a quoted TRX swap: the quoted call with
 * the 1 TRX value, re-anchored to the head block and re-encoded by TronWeb
 * (upper-case hex, zero token fields).
 */
const swapRawData = (transactionRequestData: unknown) => ({
  contract: [
    {
      parameter: {
        value: {
          owner_address: '41FCAD0B19BB29D4674531D6F115237E16AFCE377C',
          contract_address: '412222222222222222222222222222222222222222',
          call_value: 1_000_000,
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

describe('Tron on-chain failure', () => {
  it('fails the swap when the receipt reverts, and "Try again" signs a new transaction', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('trx-swap')
    // Included and reverted: top-level result FAILED, receipt REVERT.
    network.failNextWith = 'REVERT'

    await expect(
      executeRoute(page.client, buildRoute(step), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionFailed })

    // The wallet signs the original quote once; the node gets exactly that.
    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.requests[0].raw_data).toEqual(
      swapRawData(step.transactionRequest?.data)
    )
    expect(page.wallet.signed).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    const failedHash = page.wallet.signed[0].txID
    // One receipt read finds the revert; the failure is not retried.
    expect(network.nodeCalls).toEqual([
      'walletsolidity/getaccount',
      'wallet/getnowblock',
      'wallet/getblock',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
    ])
    // No `/status` poll for a reverted transaction.
    expect(network.apiCalls).toEqual([])
    expect(recorder.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    const failed = recorder.last()
    expect(failed.steps[0].execution?.status).toBe('FAILED')
    // The message carries the receipt result: REVERT is `TransactionFailed`
    // (only OUT_OF_ENERGY maps to `InsufficientFunds`).
    expect(actionOf(failed, 'SWAP')).toMatchObject({
      status: 'FAILED',
      txHash: failedHash,
      error: {
        code: LiFiErrorCode.TransactionFailed,
        message: 'Transaction failed on-chain: REVERT.',
      },
    })

    // "Try again": the widget resumes the stored route on the same page.
    const retry = recordRoute()
    const retried = await resumeRoute(page.client, failed, {
      updateRouteHook: retry.updateRouteHook,
    })

    // `prepareRestart` drops the FAILED swap even with its txHash, and the
    // transaction request: a new quote, a new signature, a new transaction.
    expect(network.apiCalls).toEqual([
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(page.wallet.requests).toHaveLength(2)
    expect(page.wallet.requests[1].raw_data).toEqual(
      swapRawData(network.requotes[0].transactionRequest?.data)
    )
    expect(page.wallet.requests[1].raw_data).not.toEqual(
      page.wallet.requests[0].raw_data
    )
    expect(page.wallet.signed).toHaveLength(2)
    const retriedHash = page.wallet.signed[1].txID
    expect(retriedHash).not.toBe(failedHash)
    // Both broadcasts, each byte for byte what the wallet signed.
    expect(network.broadcasts).toEqual(page.wallet.signed)
    // `/status` is asked only about the new transaction, never the reverted.
    expect(network.statusRequests).toEqual([
      {
        fromChain: '728126428',
        fromAddress: WALLET_ADDRESS,
        toChain: '728126428',
        txHash: retriedHash,
        bridge: 'sunswap',
      },
    ])
    expect(retry.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(retried.steps[0].execution?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(retried, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: retriedHash,
      txLink: `https://tronscan.test/#/transaction/${retriedHash}`,
    })
  })
})
