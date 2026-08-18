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
    // Echo one signed output per input so the array shape is preserved.
    signTransaction: (...inputs: unknown[]) =>
      inputs.map(() => ({ signedTransaction: new Uint8Array([1]) })),
  }),
}))

vi.mock('@solana/kit', async (importActual) => {
  const actual = await importActual<typeof import('@solana/kit')>()
  return {
    ...actual,
    getTransactionCodec: () => ({ decode: () => ({}) }),
  }
})

const { SolanaSignAndExecuteTask } = await import(
  './SolanaSignAndExecuteTask.js'
)

const baseContext = () =>
  ({
    step: {},
    wallet: {},
    walletAccount: {},
    executionOptions: undefined,
    isBridgeExecution: false,
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction: () => {},
    },
  }) as never

describe('SolanaSignAndExecuteTask', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset()
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
})
