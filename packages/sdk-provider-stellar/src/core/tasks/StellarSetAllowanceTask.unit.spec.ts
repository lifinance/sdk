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
  return {
    xdr: transaction.toXdr(),
    hash: Buffer.from(transaction.hash()).toString('hex'),
  }
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
      approval: { spender: ROUTER, tokenAddress: TOKEN, amount: 1000n },
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

  const approval = { spender: ROUTER, tokenAddress: TOKEN, amount: 1000n }

  describe('shouldRun', () => {
    it('runs when a leg needs an approval and the allowance is short', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approval,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(true)
    })

    it('skips when the allowance already suffices', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approval,
          hasSufficientAllowance: true,
        } as never)
      ).resolves.toBe(false)
    })

    it('skips when no leg needs an approval', async () => {
      await expect(
        new StellarSetAllowanceTask().shouldRun({
          approval: undefined,
          hasSufficientAllowance: false,
        } as never)
      ).resolves.toBe(false)
    })
  })

  it('approves the resolved leg token, spender and amount', async () => {
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

  it('approves the leg token even when it differs from the route source token', async () => {
    const intermediateToken = StrKey.encodeContract(Buffer.alloc(32, 5))
    const { context } = makeContext({
      approval: {
        spender: ROUTER,
        tokenAddress: intermediateToken,
        amount: 990n,
      },
    })

    await new StellarSetAllowanceTask().run(context)

    expect(buildApproveTransaction).toHaveBeenCalledWith(
      {},
      intermediateToken,
      keypair.publicKey(),
      ROUTER,
      990n,
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
    let confirmed = false
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'rpc-hash'
    })
    // Resolve on a later tick so a fire-and-forget confirmation would be
    // observable: run() must not return until this has actually settled.
    waitForStellarTransaction.mockImplementation(async () => {
      order.push('wait')
      await new Promise((resolve) => setTimeout(resolve, 5))
      confirmed = true
    })
    const { context, hash } = makeContext()

    const result = await new StellarSetAllowanceTask().run(context)

    // The whole point of this task: the route envelope is fetched by the NEXT
    // task from a live getAccount read, so the approval must be in a closed
    // ledger before run() hands control back.
    expect(confirmed).toBe(true)
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
