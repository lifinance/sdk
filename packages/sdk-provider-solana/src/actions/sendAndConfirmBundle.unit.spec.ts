import { LiFiErrorCode, RPCError } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@solana/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solana/kit')>()),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
}))

const getJitoRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getJitoRpcs: (...args: unknown[]) => getJitoRpcs(...args),
}))

const getTransactionLifetime = vi.fn()
vi.mock('../utils/getTransactionLifetime.js', () => ({
  getTransactionLifetime: (...args: unknown[]) =>
    getTransactionLifetime(...args),
}))

const confirmBundle = vi.fn()
vi.mock('../confirmation/confirmBundle.js', () => ({
  confirmBundle: (...args: unknown[]) => confirmBundle(...args),
}))

const { sendAndConfirmBundle } = await import('./sendAndConfirmBundle.js')

const sendBundle = vi.fn()
/** Options every `sendBundle(...).send(...)` call received. */
const sendBundleOptions: unknown[] = []
const rpc = {
  sendBundle: (...args: unknown[]) => ({
    send: (options: unknown) => {
      sendBundleOptions.push(options)
      return sendBundle(...args)
    },
  }),
}

const TRANSACTIONS = [{}, {}] as Transaction[]

describe('sendAndConfirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendBundleOptions.length = 0
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
  })

  it('throws a configuration error, not a bare rpc-unavailable, when no Jito RPC is configured', async () => {
    // The default LI.FI Solana RPCs answer `getBundleStatuses` with "method
    // not found", so an integrator who configured nothing reaches this path
    // on every bundle route. Racing zero RPCs would produce `rpc-unavailable`
    // with an empty error list - indistinguishable from an outage - so the
    // configuration gap must be named before anything is raced.
    getJitoRpcs.mockResolvedValue([])

    const thrown = await sendAndConfirmBundle({} as never, TRANSACTIONS).catch(
      (e) => e
    )

    expect(thrown).toBeInstanceOf(RPCError)
    expect(LiFiErrorCode.RpcUnavailable).toBe(1027)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('no configured Solana RPC supports Jito')
    expect(thrown.message).toContain('rpcUrls')
    expect(confirmBundle).not.toHaveBeenCalled()
  })

  it('returns rpc-unavailable when sendBundle throws on every RPC', async () => {
    getJitoRpcs.mockResolvedValue([rpc])
    sendBundle.mockRejectedValue(new Error('jito rejected the bundle'))
    // `confirmBundle` owns the submission now, so the failure surfaces through
    // the callback it was handed.
    confirmBundle.mockImplementation(
      (options: { send: () => Promise<string> }) => options.send()
    )

    const result = await sendAndConfirmBundle({} as never, TRANSACTIONS)

    expect(result.kind).toBe('rpc-unavailable')
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors[0].message).toBe('jito rejected the bundle')
  })

  it('hands the submission to confirmBundle instead of sending first', async () => {
    // The deadline is built inside `confirmBundle`, on the same clock as
    // `BRANCH_TIMEOUT_MS`. Submitting here first would spend part of that
    // budget before the deadline exists.
    getJitoRpcs.mockResolvedValue([rpc])
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockResolvedValue({ kind: 'not-confirmed' })

    await sendAndConfirmBundle({} as never, TRANSACTIONS)

    expect(confirmBundle).toHaveBeenCalledTimes(1)
    expect(sendBundle).not.toHaveBeenCalled()

    const { send } = confirmBundle.mock.calls[0][0] as {
      send: () => Promise<string>
    }
    await expect(send()).resolves.toBe('bundle-1')
    expect(sendBundle).toHaveBeenCalledWith([
      'base64-encoded-tx',
      'base64-encoded-tx',
    ])
  })

  it('forwards the branch abort signal to the bundle submission', async () => {
    // `BRANCH_TIMEOUT_MS` can only end a hung `sendBundle` through this
    // signal. It must be the branch's own signal, by identity - the one
    // `raceRpcs` hands to the branch and later aborts.
    getJitoRpcs.mockResolvedValue([rpc])
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: { send: () => Promise<string> }) => {
        await options.send()
        return { kind: 'not-confirmed' }
      }
    )

    await sendAndConfirmBundle({} as never, TRANSACTIONS)

    const { signal } = confirmBundle.mock.calls[0][0] as {
      signal: AbortSignal
    }
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(sendBundleOptions).toEqual([{ abortSignal: signal }])
  })

  it('reports the broadcast once, however many branches submit successfully', async () => {
    // Two Jito RPCs both accept the submission; the caller's callback fires
    // for the first only. The once-guard lives here so the wait task's
    // status write happens a single time.
    const rpcB = {
      sendBundle: (...args: unknown[]) => ({
        send: (options: unknown) => {
          sendBundleOptions.push(options)
          return sendBundle(...args)
        },
      }),
    }
    getJitoRpcs.mockResolvedValue([rpc, rpcB])
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: {
        send: () => Promise<string>
        onBroadcast: () => void
      }) => {
        await options.send()
        options.onBroadcast()
        return { kind: 'not-confirmed' }
      }
    )
    const onBroadcast = vi.fn()

    await sendAndConfirmBundle({} as never, TRANSACTIONS, { onBroadcast })

    expect(confirmBundle).toHaveBeenCalledTimes(2)
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('passes the lifetime of every signed transaction, not just the first', async () => {
    getJitoRpcs.mockResolvedValue([rpc])
    sendBundle.mockResolvedValue('bundle-1')
    getTransactionLifetime
      .mockResolvedValueOnce({ kind: 'blockhash', blockhash: 'A' })
      .mockResolvedValueOnce({ kind: 'blockhash', blockhash: 'B' })
    const confirmation = {
      bundleId: 'bundle-1',
      txSignatures: ['sig0', 'sig1'],
      signatureResults: [{ err: null }, { err: null }],
    }
    confirmBundle.mockResolvedValue({ kind: 'confirmed', value: confirmation })

    const result = await sendAndConfirmBundle({} as never, TRANSACTIONS)

    expect(result).toEqual({ kind: 'confirmed', value: confirmation })
    expect(getTransactionLifetime).toHaveBeenCalledTimes(2)
    expect(confirmBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        lifetimes: [
          { kind: 'blockhash', blockhash: 'A' },
          { kind: 'blockhash', blockhash: 'B' },
        ],
      })
    )
  })
})
