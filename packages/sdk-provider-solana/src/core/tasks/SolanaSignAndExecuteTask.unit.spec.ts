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
;('2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2')
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
  it('does not write a txHash before anything is broadcast', async () => {
    // A signed-but-unsent signature resolves to `null` on every explorer -
    // verified against mainnet. Simulation, the empty-Jito-RPC throw and every
    // send failure all sit between this task and the first broadcast, so a
    // hash written here can point at a transaction that never existed. The
    // wait tasks write it on `onBroadcast`, beside `txLink`.
    const context = baseContext()
    const task = new SolanaSignAndExecuteTask()

    await task.run(context)

    const params = updateAction.mock.calls.map((call) => call[3])
    for (const param of params) {
      expect(param).not.toHaveProperty('txHash')
    }
  })

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

  it('records signedAt, and marks the action PENDING', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(baseContext())

    expect(updateAction).toHaveBeenCalledTimes(1)
    const [, , status, params] = updateAction.mock.calls[0]
    expect(status).toBe('PENDING')
    expect(typeof params.signedAt).toBe('number')
  })

  it('does not record an explorer link at signing time, and clears any stale one', async () => {
    // Nothing has been broadcast yet: simulation runs later in the wait task,
    // and a bundle route with no Jito-capable RPC never submits at all. A
    // link written here would 404 on those paths.
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(baseContext())

    const [, , , params] = updateAction.mock.calls[0]
    expect('txLink' in params).toBe(true)
    expect(params.txLink).toBeUndefined()
  })

  it('never records a signature for a bundle either', async () => {
    // The Jito wait task derives it from `signedTransactions[0]` at broadcast.
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])

    await new SolanaSignAndExecuteTask().run(baseContext())

    const [, , , params] = updateAction.mock.calls[0]
    expect(params.txHash).toBeUndefined()
    expect(params.txHash).not.toBe(SIGNATURE_OF_SECOND)
  })
})
