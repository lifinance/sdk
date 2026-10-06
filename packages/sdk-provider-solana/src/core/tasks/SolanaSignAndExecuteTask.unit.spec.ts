import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTransactionRequestData = vi.fn()

vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getTransactionRequestData: (...args: unknown[]) =>
      getTransactionRequestData(...args),
  }
})

// Mutable so one spec can make the decoder throw, and another can hand back
// a transaction without its fee payer signature. `vi.hoisted` because the
// `vi.mock` factory below is hoisted above ordinary top-level declarations.
const decoder = vi.hoisted(() => ({
  throws: false,
  nullSignatureAt: undefined as number | undefined,
}))
// Mutable so one spec can replace the wallet's answer.
const wallet = vi.hoisted(() => ({
  signTransaction: undefined as undefined | (() => Promise<never>),
}))

vi.mock('../../utils/base64ToUint8Array.js', () => ({
  base64ToUint8Array: () => new Uint8Array([1]),
}))

vi.mock('../../utils/getWalletFeature.js', () => ({
  getWalletFeature: () => ({
    // Echo one signed output per input so the array shape is preserved, and
    // tag every output with its position so the decoder below can hand back a
    // distinct transaction per position.
    signTransaction: (...inputs: unknown[]) =>
      wallet.signTransaction?.() ??
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
      decode: (bytes: Uint8Array) => {
        if (decoder.throws) {
          throw new Error('undecodable signed transaction')
        }
        return {
          signatures: {
            feePayer:
              bytes[0] === decoder.nullSignatureAt
                ? null
                : new Uint8Array(64).fill(bytes[0] + 1),
          },
        }
      },
    }),
  }
})

const { SolanaSignAndExecuteTask } = await import(
  './SolanaSignAndExecuteTask.js'
)
const { LiFiErrorCode, StatusManager, TransactionError } = await import(
  '@lifi/sdk'
)

const updateAction = vi.fn()
const getWalletAccount = vi.fn((_step: unknown) => ({}))

const baseContext = (action: object = { type: 'SWAP' }) =>
  ({
    step: {},
    wallet: {},
    getWalletAccount: (step: unknown) => getWalletAccount(step),
    executionOptions: undefined,
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
    statusManager: {
      findAction: () => action,
      updateAction,
    },
  }) as never

describe('SolanaSignAndExecuteTask', () => {
  it('writes no txHash before anything is broadcast, and clears any stale one', async () => {
    // A signed-but-unsent signature resolves to `null` on every explorer -
    // verified against mainnet. Simulation, the empty-Jito-RPC throw and every
    // send failure all sit between this task and the first broadcast, so a
    // hash written here can point at a transaction that never existed. The
    // wait tasks write it on `onBroadcast`, beside `txLink`.
    //
    // Written as an explicit `undefined` rather than omitted: `prepareRestart`
    // keeps a PENDING action precisely because its `txHash` is truthy, so a
    // resumed run that failed before its first broadcast would otherwise report
    // the previous run's signature.
    const context = baseContext()
    const task = new SolanaSignAndExecuteTask()

    await task.run(context)

    const params = updateAction.mock.calls.map((call) => call[3])
    for (const param of params) {
      expect(param.txHash).toBeUndefined()
    }
    // The clearing write comes first; the last write stores the signed bytes.
    const clearingWrite = params[0]
    expect('txHash' in clearingWrite).toBe(true)
  })

  beforeEach(() => {
    getTransactionRequestData.mockReset()
    updateAction.mockReset()
    decoder.throws = false
    decoder.nullSignatureAt = undefined
    wallet.signTransaction = undefined
    getWalletAccount.mockReset()
    getWalletAccount.mockReturnValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports TransactionExpired when the wallet does not answer within two minutes', async () => {
    vi.useFakeTimers()
    getTransactionRequestData.mockResolvedValue('tx-a')
    wallet.signTransaction = () => new Promise<never>(() => {})

    const run = expect(
      new SolanaSignAndExecuteTask().run(baseContext())
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionExpired })
    await vi.advanceTimersByTimeAsync(120_000)

    await run
  })

  it('passes an AbortError from the wallet through, not as TransactionExpired', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')
    const abortError = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    })
    wallet.signTransaction = () => Promise.reject(abortError)

    await expect(
      new SolanaSignAndExecuteTask().run(baseContext())
    ).rejects.toBe(abortError)
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

    // The clearing write, then the stored bytes.
    expect(updateAction).toHaveBeenCalledTimes(2)
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

  it('clears a stale txHash even when the decode throws', async () => {
    // `prepareRestart` keeps a PENDING action *because* its `txHash` is
    // truthy, so the clearing write has to land before anything that can
    // reject. A decode failure that skipped it left the previous run's
    // signature and explorer link on the action.
    getTransactionRequestData.mockResolvedValue('tx-a')
    decoder.throws = true

    await expect(
      new SolanaSignAndExecuteTask().run(baseContext())
    ).rejects.toThrow('undecodable signed transaction')

    expect(updateAction).toHaveBeenCalledTimes(1)
    const [, , status, params] = updateAction.mock.calls[0]
    expect(status).toBe('PENDING')
    expect('txHash' in params).toBe(true)
    expect(params.txHash).toBeUndefined()
    expect('txLink' in params).toBe(true)
    expect(typeof params.signedAt).toBe('number')
    // Nothing is stored for bytes that do not decode.
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
  })

  it('never records a signature for a bundle either', async () => {
    // The Jito wait task derives it from `signedTransactions[0]` at broadcast.
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])

    await new SolanaSignAndExecuteTask().run(baseContext())

    const [, , , params] = updateAction.mock.calls[0]
    expect(params.txHash).toBeUndefined()
    expect(params.txHash).not.toBe(SIGNATURE_OF_SECOND)
  })

  it('clears the previous transaction, then stores the signed wire bytes', async () => {
    // Spec 4.2.1: a stale final hash would look open again once its
    // `txFinal` is gone, so every field of the previous transaction goes
    // before the new bytes are written.
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(baseContext())

    expect(updateAction).toHaveBeenCalledTimes(2)
    const [clearing, storing] = updateAction.mock.calls.map((call) => call[3])
    for (const field of ['txHash', 'txLink', 'txHex', 'txFinal', 'taskId']) {
      expect(field in clearing, field).toBe(true)
      expect(clearing[field], field).toBeUndefined()
    }
    // The fake wallet signs input 0 as the byte [0]: base64 `AA==`.
    expect(storing).toEqual({ txHex: 'AA==' })
    expect(updateAction.mock.calls[1][2]).toBe('PENDING')
  })

  it('stores a bundle as a JSON array of wire transactions', async () => {
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])

    await new SolanaSignAndExecuteTask().run(baseContext())

    expect(updateAction.mock.calls[1][3]).toEqual({
      txHex: '["AA==","AQ=="]',
    })
  })

  it('keeps a one-element bundle a bundle in txHex', async () => {
    // The leading `[` is what tells a resume to use `sendBundle`.
    getTransactionRequestData.mockResolvedValue(['tx-a'])

    const result = await new SolanaSignAndExecuteTask().run(baseContext())

    expect(result.context?.isBundleExecution).toBe(true)
    expect(updateAction.mock.calls[1][3]).toEqual({ txHex: '["AA=="]' })
  })

  it('stores nothing when a transaction carries no fee payer signature', async () => {
    // Spec 4.2.9: bytes without a readable signature would fail every
    // resume the same way. Nothing was sent, so "Try again" signs again.
    getTransactionRequestData.mockResolvedValue(['tx-a', 'tx-b'])
    decoder.nullSignatureAt = 1

    await expect(
      new SolanaSignAndExecuteTask().run(baseContext())
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionUnprepared })

    expect(updateAction).toHaveBeenCalledTimes(1)
    expect(updateAction.mock.calls[0][3].txHex).toBeUndefined()
  })

  it.each([
    ['a broadcast signature', { status: 'PENDING', txHash: 'sig' }],
    ['stored signed bytes', { status: 'PENDING', txHex: 'AA==' }],
    ['an unknown failed outcome', { status: 'FAILED', txHash: 'sig' }],
  ])('refuses to sign over %s', async (_label, fields) => {
    // Defence in depth behind the selector: a second signature while the
    // first transaction can still land is the double spend.
    getTransactionRequestData.mockResolvedValue('tx-a')

    await expect(
      new SolanaSignAndExecuteTask().run(
        baseContext({ type: 'SWAP', ...fields })
      )
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    expect(getWalletAccount).not.toHaveBeenCalled()
    expect(getTransactionRequestData).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  // An older run's late write can merge its transaction into this action
  // while the task awaits the quote (spec addendum §5.2 case 1).
  it('checks the action again right before the wallet and never asks it to sign when a transaction merged meanwhile', async () => {
    const context = baseContext({ type: 'SWAP', status: 'STARTED' }) as {
      statusManager: { findAction: () => object }
    }
    getTransactionRequestData.mockImplementationOnce(async () => {
      context.statusManager.findAction = () => ({
        type: 'SWAP',
        status: 'PENDING',
        txHex: 'AA==',
      })
      return 'tx-a'
    })
    // Records the wallet call; `undefined` keeps the default answer.
    const walletSignTransaction = vi.fn(() => undefined)
    wallet.signTransaction = walletSignTransaction as never

    await expect(
      new SolanaSignAndExecuteTask().run(context as never)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    expect(getTransactionRequestData).toHaveBeenCalledTimes(1)
    expect(walletSignTransaction).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  // A stop during this run's prompt, then a resume: the older run signs, and
  // its late write merges its bytes into this action while this prompt is
  // still open.
  it('checks the action again after the wallet and stores nothing when a transaction merged while the prompt was open', async () => {
    // A real manager. Without route state, `allowUpdates(false)` keeps every
    // write on the step.
    const statusManager = new StatusManager('route-1')
    statusManager.allowUpdates(false)
    const step = {
      execution: {
        status: 'PENDING',
        actions: [{ type: 'SWAP', status: 'STARTED' }],
      },
    }
    getTransactionRequestData.mockResolvedValue('tx-a')
    wallet.signTransaction = (() => {
      statusManager.updateAction(step as never, 'SWAP', 'PENDING', {
        txHex: 'MERGED',
        signedAt: 1_800_000_000_000,
      })
      // `undefined` keeps the default answer: a signed transaction.
      return undefined
    }) as never
    const writes = vi.spyOn(statusManager, 'updateAction')

    await expect(
      new SolanaSignAndExecuteTask().run({
        ...(baseContext() as object),
        step,
        statusManager,
      } as never)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    // Only the merge: no clear, and no bytes of this run.
    expect(writes).toHaveBeenCalledTimes(1)
    expect(step.execution.actions).toEqual([
      expect.objectContaining({ type: 'SWAP', txHex: 'MERGED' }),
    ])
    expect(step.execution).toMatchObject({ signedAt: 1_800_000_000_000 })
  })

  it('signs again after a final failure, and clears its fields', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(
      baseContext({
        type: 'SWAP',
        status: 'FAILED',
        txFinal: true,
        txHash: 'old-sig',
        txLink: 'https://explorer/tx/old-sig',
      })
    )

    const clearing = updateAction.mock.calls[0][3]
    expect('txFinal' in clearing).toBe(true)
    expect(clearing.txFinal).toBeUndefined()
    expect(clearing.txHash).toBeUndefined()
    expect(clearing.txLink).toBeUndefined()
  })

  it('resolves the wallet account when it signs', async () => {
    getTransactionRequestData.mockResolvedValue('tx-a')

    await new SolanaSignAndExecuteTask().run(baseContext())

    expect(getWalletAccount).toHaveBeenCalledTimes(1)
  })

  it('reports WalletChangedDuringExecution from the resolver before asking for a transaction', async () => {
    const walletChanged = new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    )
    getWalletAccount.mockImplementationOnce(() => {
      throw walletChanged
    })

    await expect(
      new SolanaSignAndExecuteTask().run(baseContext())
    ).rejects.toBe(walletChanged)

    expect(getTransactionRequestData).not.toHaveBeenCalled()
  })
})
