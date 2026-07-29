import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildApproveTransaction = vi.fn()
vi.mock('./helpers/buildApproveTransaction.js', () => ({
  buildApproveTransaction: (...args: unknown[]) =>
    buildApproveTransaction(...args),
}))

const submitStellarTransaction = vi.fn()
vi.mock('./helpers/submitStellarTransaction.js', () => ({
  submitStellarTransaction: (...args: unknown[]) =>
    submitStellarTransaction(...args),
}))

const waitForStellarTransaction = vi.fn()
vi.mock('./helpers/waitForStellarTransaction.js', () => ({
  waitForStellarTransaction: (...args: unknown[]) =>
    waitForStellarTransaction(...args),
}))

const { StellarSetAllowanceTask } = await import('./StellarSetAllowanceTask.js')

const NETWORK = Networks.TESTNET
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 3))
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4))
const keypair = Keypair.random()

/** A real signed envelope, so the locally derived hash is meaningful. */
const signedApproveEnvelope = (): { xdr: string; hash: string } => {
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
  return { xdr: transaction.toXDR(), hash: transaction.hash().toString('hex') }
}

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const { xdr, hash } = signedApproveEnvelope()
  const updateAction = vi.fn()
  const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: xdr })
  return {
    hash,
    updateAction,
    signTransaction,
    context: {
      client: {},
      wallet: { address: keypair.publicKey(), signTransaction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      networkPassphrase: NETWORK,
      approvalSpender: ROUTER,
      allowUserInteraction: true,
      checkWallet: () => {},
      step: {
        action: {
          fromChainId: 1500,
          fromAmount: '1000',
          fromToken: { address: TOKEN },
        },
        estimate: { approvalAddress: ROUTER },
      },
      statusManager: {
        initializeAction: () => ({ type: 'SET_ALLOWANCE' }),
        updateAction,
      },
      ...overrides,
    } as never,
  }
}

describe('StellarSetAllowanceTask', () => {
  beforeEach(() => {
    buildApproveTransaction.mockReset().mockResolvedValue('UNSIGNED')
    submitStellarTransaction.mockReset().mockResolvedValue('rpc-hash')
    waitForStellarTransaction.mockReset().mockResolvedValue({})
  })

  describe('shouldRun', () => {
    it('runs when a spender resolved and the allowance is short', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approvalSpender: ROUTER,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(true)
    })

    it('skips when the allowance already suffices', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approvalSpender: ROUTER,
          hasSufficientAllowance: true,
        } as never)
      ).resolves.toBe(false)
    })

    it('skips when no spender resolved', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approvalSpender: undefined,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(false)
    })
  })

  it('approves exactly fromAmount', async () => {
    const { context } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(buildApproveTransaction).toHaveBeenCalledWith(
      {},
      TOKEN,
      keypair.publicKey(),
      ROUTER,
      1000n,
      NETWORK
    )
  })

  it('derives the approval hash locally rather than trusting the submit response', async () => {
    const { context, hash, updateAction } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SET_ALLOWANCE',
      'PENDING',
      { txHash: hash, txLink: `https://explorer/tx/${hash}` }
    )
  })

  // The backend builds the route envelope from a live getAccount read, so an
  // unconfirmed approval would yield an envelope carrying the pre-approval
  // sequence number and fail with tx_bad_seq.
  it('waits for on-chain confirmation, and only after submitting', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'rpc-hash'
    })
    waitForStellarTransaction.mockImplementation(async () => {
      order.push('wait')
    })
    const { context, hash } = makeContext()

    const result = await new StellarSetAllowanceTask().run(context)

    expect(order).toEqual(['submit', 'wait'])
    expect(waitForStellarTransaction).toHaveBeenCalledWith({}, hash, undefined)
    expect(result).toEqual({
      status: 'COMPLETED',
      context: { hasSufficientAllowance: true },
    })
  })

  it('pauses without prompting when interaction is disallowed', async () => {
    const { context, signTransaction } = makeContext({
      allowUserInteraction: false,
    })

    const result = await new StellarSetAllowanceTask().run(context)

    expect(result).toEqual({ status: 'PAUSED' })
    expect(signTransaction).not.toHaveBeenCalled()
    expect(buildApproveTransaction).not.toHaveBeenCalled()
  })

  it('clears a previous attempt txHash before prompting again', async () => {
    const { context, updateAction } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SET_ALLOWANCE',
      'ACTION_REQUIRED',
      { txHash: undefined, txLink: undefined }
    )
  })

  it('marks the action DONE once confirmed', async () => {
    const { context, updateAction } = makeContext()

    await new StellarSetAllowanceTask().run(context)

    expect(updateAction).toHaveBeenLastCalledWith(
      expect.anything(),
      'SET_ALLOWANCE',
      'DONE'
    )
  })
})
