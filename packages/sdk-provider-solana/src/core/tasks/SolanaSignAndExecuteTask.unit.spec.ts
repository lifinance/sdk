import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTransactionRequestData = vi.fn()

vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getTransactionRequestData: (...args: unknown[]) =>
      getTransactionRequestData(...args),
  }
})

vi.mock('../../utils/base64ToUint8Array.js', () => ({
  base64ToUint8Array: () => new Uint8Array([1]),
}))

vi.mock('../../utils/getWalletFeature.js', () => ({
  getWalletFeature: () => ({
    // Echo one signed output per input so the array shape is preserved, and
    // tag every output with its position so the decoder below can hand back a
    // distinct transaction per position.
    signTransaction: (...inputs: unknown[]) =>
      inputs.map((_, index) => ({
        signedTransaction: new Uint8Array([index]),
      })),
  }),
}))

// Base58 of a 64 byte signature filled with the byte at index + 1. Hard coded
// so the test pins the encoding as well as which transaction was picked.
const SIGNATURE_OF_FIRST =
  '2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2'
const SIGNATURE_OF_SECOND =
  '3L3RY5sT8K4kyEnqhizwaqxLEbcYvpGrGPNEYRwtbCSUtL6YL86jdrvCbohnP5q8VxQ3qzGmt3W3iQJW97rD7m3'

vi.mock('@solana/kit', async (importActual) => {
  const actual = await importActual<typeof import('@solana/kit')>()
  return {
    ...actual,
    // Only the codec is faked. `getSignatureFromTransaction` stays real, so
    // these tests also prove it accepts a decoded signed transaction.
    getTransactionCodec: () => ({
      decode: (bytes: Uint8Array) => ({
        signatures: { feePayer: new Uint8Array(64).fill(bytes[0] + 1) },
      }),
    }),
  }
})

const { SolanaSignAndExecuteTask } = await import(
  './SolanaSignAndExecuteTask.js'
)

const updateAction = vi.fn()

const baseContext = () =>
  ({
    step: {},
    wallet: {},
    walletAccount: {},
    executionOptions: undefined,
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction,
    },
  }) as never

describe('SolanaSignAndExecuteTask', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset()
    updateAction.mockReset()
  })

  it('flags a bundle when transaction data is an array', async () => {
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])

    const result = await new SolanaSignAndExecuteTask().run(baseContext())

    expect(result.status).toBe('COMPLETED')
    expect(result.context?.isBundleExecution).toBe(true)
    expect(result.context?.signedTransactions).toHaveLength(2)
  })

  it('does not flag a bundle when transaction data is a string', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')

    const result = await new SolanaSignAndExecuteTask().run(baseContext())

    expect(result.status).toBe('COMPLETED')
    expect(result.context?.isBundleExecution).toBe(false)
    expect(result.context?.signedTransactions).toHaveLength(1)
  })

  it('records the signature before the confirmation wait so a failed wait leaves a transaction to look up', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(baseContext())

    expect(updateAction).toHaveBeenCalledTimes(1)
    const [, , status, params] = updateAction.mock.calls[0]
    expect(status).toBe('PENDING')
    expect(params.txHash).toBe(SIGNATURE_OF_FIRST)
    expect(params.txLink).toBe(`https://explorer/tx/${SIGNATURE_OF_FIRST}`)
    expect(typeof params.signedAt).toBe('number')
  })

  it('records the first bundled transaction, the one the Jito wait task reports', async () => {
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])

    await new SolanaSignAndExecuteTask().run(baseContext())

    const [, , , params] = updateAction.mock.calls[0]
    expect(params.txHash).toBe(SIGNATURE_OF_FIRST)
    expect(params.txHash).not.toBe(SIGNATURE_OF_SECOND)
  })
})
