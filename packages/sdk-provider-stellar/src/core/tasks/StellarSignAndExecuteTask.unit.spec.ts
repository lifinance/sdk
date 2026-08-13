import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTransactionRequestData = vi.fn()
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  return {
    ...actual,
    getTransactionRequestData: (...args: unknown[]) =>
      getTransactionRequestData(...args),
  }
})

const submitStellarTransaction = vi.fn()
vi.mock('./helpers/submitStellarTransaction.js', () => ({
  submitStellarTransaction: (...args: unknown[]) =>
    submitStellarTransaction(...args),
  waitForStellarTransaction: vi.fn(),
}))

const { StellarSignAndExecuteTask } = await import(
  './StellarSignAndExecuteTask.js'
)

const NETWORK = Networks.TESTNET
const keypair = Keypair.random()

/** A real signed envelope, so the derived-hash assertions are meaningful. */
const buildSignedTransaction = (): Transaction => {
  const transaction = new TransactionBuilder(
    new Account(keypair.publicKey(), '1'),
    { fee: BASE_FEE, networkPassphrase: NETWORK }
  )
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '1',
      })
    )
    .setTimeout(300)
    .build()
  transaction.sign(keypair)
  return transaction
}

const makeContext = (
  signedTxXdr: string,
  onUpdateAction?: () => void
): {
  context: never
  updateAction: ReturnType<typeof vi.fn>
  signTransaction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr })
  return {
    updateAction,
    signTransaction,
    context: {
      client: {},
      wallet: { address: keypair.publicKey(), signTransaction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      networkPassphrase: NETWORK,
      isBridgeExecution: false,
      checkWallet: () => {},
      step: { action: { fromAddress: keypair.publicKey() } },
      statusManager: {
        findAction: () => ({ type: 'SWAP' }),
        updateAction: (...args: unknown[]) => {
          onUpdateAction?.()
          updateAction(...args)
        },
      },
    } as never,
  }
}

describe('StellarSignAndExecuteTask', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset().mockResolvedValue('UNSIGNED_XDR')
    submitStellarTransaction.mockReset().mockResolvedValue('network-hash')
  })

  it('derives the hash from the signed envelope rather than the submit response', async () => {
    const transaction = buildSignedTransaction()
    const expectedHash = transaction.hash().toString('hex')
    const signedTxXdr = transaction.toXDR()
    const { context, updateAction } = makeContext(signedTxXdr)

    const result = await new StellarSignAndExecuteTask().run(context)

    expect(result.context).toEqual({ transactionHash: expectedHash })
    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'PENDING',
      expect.objectContaining({
        txHash: expectedHash,
        txLink: `https://explorer/tx/${expectedHash}`,
        txHex: signedTxXdr,
      })
    )
  })

  it('persists the hash BEFORE submitting, so a crash resumes by polling instead of re-signing', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'network-hash'
    })
    const { context } = makeContext(buildSignedTransaction().toXDR(), () =>
      order.push('updateAction')
    )

    await new StellarSignAndExecuteTask().run(context)

    expect(order).toEqual(['updateAction', 'submit'])
  })

  it('signs the payload returned by getTransactionRequestData', async () => {
    const { context, signTransaction } = makeContext(
      buildSignedTransaction().toXDR()
    )

    await new StellarSignAndExecuteTask().run(context)

    expect(signTransaction).toHaveBeenCalledWith('UNSIGNED_XDR', {
      address: keypair.publicKey(),
      networkPassphrase: NETWORK,
    })
  })
})
