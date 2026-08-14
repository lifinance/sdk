import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn().mockResolvedValue('signature')
const getBlockHeight = vi.fn(() => ({ send: vi.fn().mockResolvedValue(100n) }))
const getEpochInfo = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({ blockHeight: 100n }),
}))
const getLatestBlockhash = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({
    value: { blockhash: 'blockhash', lastValidBlockHeight: 200n },
  }),
}))
const getSignatureStatuses = vi.fn(() => ({
  send: vi.fn().mockResolvedValue({
    value: [
      {
        confirmationStatus: 'confirmed',
        confirmations: 1n,
        err: null,
        slot: 1n,
        status: { Ok: null },
      },
    ],
  }),
}))
const sendTransaction = vi.fn(() => ({ send }))

const rpc = {
  getBlockHeight,
  getEpochInfo,
  getLatestBlockhash,
  getSignatureStatuses,
  sendTransaction,
}

vi.mock('../rpc/registry.js', () => ({
  getSolanaRpcs: vi.fn().mockResolvedValue([rpc]),
}))

vi.mock('@solana/kit', () => ({
  getBase64EncodedWireTransaction: vi.fn().mockReturnValue('transaction'),
  getSignatureFromTransaction: vi.fn().mockReturnValue('signature'),
}))

vi.mock('@lifi/sdk', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

const { sendAndConfirmTransaction } = await import(
  './sendAndConfirmTransaction.js'
)

describe('sendAndConfirmTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes maxRetries as a JSON-RPC number', async () => {
    await sendAndConfirmTransaction({} as never, {} as never)

    expect(sendTransaction).toHaveBeenCalled()
    expect(sendTransaction.mock.calls[0][1].maxRetries).toBe(0)
  })

  it('derives block height from epoch info', async () => {
    await sendAndConfirmTransaction({} as never, {} as never)

    expect(getEpochInfo).toHaveBeenCalled()
    expect(getBlockHeight).not.toHaveBeenCalled()
  })
})
