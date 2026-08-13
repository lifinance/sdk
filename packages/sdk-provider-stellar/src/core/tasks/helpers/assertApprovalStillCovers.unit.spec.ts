import { LiFiErrorCode, type TransactionError } from '@lifi/sdk'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readAllowance = vi.fn()
vi.mock('./readAllowance.js', () => ({
  readAllowance: (...args: unknown[]) => readAllowance(...args),
}))

const { assertApprovalStillCovers } = await import(
  './assertApprovalStillCovers.js'
)

const CIRCLE_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 7))
const OTHER_ADAPTER = StrKey.encodeContract(Buffer.alloc(32, 9))
const XLM_USDC = StrKey.encodeContract(Buffer.alloc(32, 4))
const WALLET = Keypair.random().publicKey()

const granted = {
  spender: CIRCLE_ADAPTER,
  tokenAddress: XLM_USDC,
  amount: 1_089n,
}

const contextWith = (
  spender: string,
  fromAmount: string,
  approval: object | undefined = granted
) =>
  ({
    client: {},
    wallet: { address: WALLET },
    networkPassphrase: 'Test SDF Network ; September 2015',
    approval,
    step: {
      action: { fromToken: { address: XLM_USDC }, fromAmount },
      estimate: { approvalAddress: spender },
      includedSteps: [
        {
          action: { fromToken: { address: XLM_USDC } },
          estimate: {
            fromAmount,
            approvalAddress: spender,
            skipApproval: false,
          },
        },
      ],
    },
  }) as never

describe('assertApprovalStillCovers', () => {
  beforeEach(() => {
    readAllowance.mockReset().mockResolvedValue(1_089n)
  })

  it('passes when the granted allowance still covers the refreshed route', async () => {
    await expect(
      assertApprovalStillCovers(contextWith(CIRCLE_ADAPTER, '990'))
    ).resolves.toBeUndefined()
  })

  // A re-quote can name a different adapter. The allowance was written for the
  // old one, so the new one reads 0 and `transfer_from` would revert on-chain
  // after a second signature.
  it('throws when the refreshed route names a different spender', async () => {
    readAllowance.mockResolvedValue(0n)

    const thrown = await assertApprovalStillCovers(
      contextWith(OTHER_ADAPTER, '990')
    ).catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionUnprepared
    )
  })

  it('throws when the refreshed amount exceeds the allowance', async () => {
    readAllowance.mockResolvedValue(1_089n)

    const thrown = await assertApprovalStillCovers(
      contextWith(CIRCLE_ADAPTER, '5000')
    ).catch((error: unknown) => error)

    expect((thrown as TransactionError).code).toBe(
      LiFiErrorCode.TransactionUnprepared
    )
  })

  // The getRoutes path grants nothing before the refresh, so there is no grant
  // to invalidate and no reason to pay for a read.
  it('reads nothing when no approval was resolved before the refresh', async () => {
    // Assigned after construction: passing `undefined` to a parameter that has
    // a default value applies the default instead of clearing it.
    const context = contextWith(CIRCLE_ADAPTER, '990')
    ;(context as unknown as { approval?: object }).approval = undefined

    await expect(assertApprovalStillCovers(context)).resolves.toBeUndefined()
    expect(readAllowance).not.toHaveBeenCalled()
  })

  it('reads nothing when the refreshed route needs no approval', async () => {
    const context = contextWith(CIRCLE_ADAPTER, '990')
    ;(
      context as unknown as { step: { includedSteps: unknown[] } }
    ).step.includedSteps = []

    await expect(assertApprovalStillCovers(context)).resolves.toBeUndefined()
    expect(readAllowance).not.toHaveBeenCalled()
  })
})
