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
const rpc = {
  sendBundle: (...args: unknown[]) => ({ send: () => sendBundle(...args) }),
}

const TRANSACTIONS = [{}, {}] as Transaction[]

describe('sendAndConfirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
  })

  it('returns rpc-unavailable when no Jito RPC is configured', async () => {
    getJitoRpcs.mockResolvedValue([])

    await expect(
      sendAndConfirmBundle({} as never, TRANSACTIONS)
    ).resolves.toEqual({ kind: 'rpc-unavailable', errors: [] })
  })

  it('returns rpc-unavailable when sendBundle throws on every RPC', async () => {
    getJitoRpcs.mockResolvedValue([rpc])
    sendBundle.mockRejectedValue(new Error('jito rejected the bundle'))

    const result = await sendAndConfirmBundle({} as never, TRANSACTIONS)

    expect(result.kind).toBe('rpc-unavailable')
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors[0].message).toBe('jito rejected the bundle')
    expect(confirmBundle).not.toHaveBeenCalled()
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
        bundleId: 'bundle-1',
        lifetimes: [
          { kind: 'blockhash', blockhash: 'A' },
          { kind: 'blockhash', blockhash: 'B' },
        ],
      })
    )
  })
})
