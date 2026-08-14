import { describe, expect, it, vi } from 'vitest'

const getBlockHeight = vi.fn(() => ({ send: vi.fn().mockResolvedValue(100n) }))
const getEpochInfo = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({ blockHeight: 100n }),
}))
const getLatestBlockhash = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({
    value: { blockhash: 'blockhash', lastValidBlockHeight: 200n },
  }),
}))
const getBundleStatuses = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({
    value: [
      {
        confirmation_status: 'confirmed',
        transactions: ['signature'],
      },
    ],
  }),
}))
const getSignatureStatuses = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({ value: [{ err: null }] }),
}))
const sendBundle = vi.fn(() => ({
  send: vi.fn().mockResolvedValue('bundle-id'),
}))

const rpc = {
  getBlockHeight,
  getBundleStatuses,
  getEpochInfo,
  getLatestBlockhash,
  getSignatureStatuses,
  sendBundle,
}

vi.mock('../rpc/registry.js', () => ({
  getJitoRpcs: vi.fn().mockResolvedValue([rpc]),
}))

vi.mock('@solana/kit', () => ({
  getBase64EncodedWireTransaction: vi.fn().mockReturnValue('transaction'),
}))

vi.mock('@lifi/sdk', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

const { sendAndConfirmBundle } = await import('./sendAndConfirmBundle.js')

describe('sendAndConfirmBundle', () => {
  it('derives block height from epoch info', async () => {
    await sendAndConfirmBundle({} as never, [{}] as never)

    expect(getEpochInfo).toHaveBeenCalled()
    expect(getBlockHeight).not.toHaveBeenCalled()
  })
})
