import type { TransactionMethodType } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))

import { canAccountUsePermit2 } from '../../../permits/canAccountUsePermit2.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolvePermit2Support } from './resolvePermit2Support.js'

const OWNER = '0xaaaa000000000000000000000000000000000001' as Address
const CHAIN_ID = 4663

const buildContext = (
  overrides: Partial<EthereumStepExecutorContext> = {}
): EthereumStepExecutorContext =>
  ({
    client: {},
    ethereumClient: { account: { address: OWNER } },
    isFromNativeToken: false,
    disableMessageSigning: false,
    fromChain: {
      id: CHAIN_ID,
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      permit2Proxy: '0x1111111111111111111111111111111111111111',
    },
    step: {
      action: { fromAddress: OWNER },
      estimate: {
        approvalAddress: '0x2222222222222222222222222222222222222222',
      },
    },
    ...overrides,
  }) as unknown as EthereumStepExecutorContext

const run = (
  context: EthereumStepExecutorContext,
  strategy: TransactionMethodType = 'standard'
) => resolvePermit2Support(context, strategy)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
})

describe('resolvePermit2Support — signer gate (JUMEMB-32)', () => {
  it('is supported for a signer that can produce a Permit2 signature', async () => {
    expect(await run(buildContext())).toBe(true)
  })

  it('is NOT supported when the signer has on-chain code', async () => {
    // The whole point: a 7702-delegated EOA passes every step/chain check but
    // its ECDSA signature is rejected by Permit2's EIP-1271 path, so the tx
    // reverts before reaching the diamond. Must fall back to approve+execute.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)
    expect(await run(buildContext())).toBe(false)
  })

  it('checks the signer on the source chain, using the address the quote was made for', async () => {
    await run(buildContext())
    expect(canAccountUsePermit2).toHaveBeenCalledWith(expect.anything(), {
      chainId: CHAIN_ID,
      address: OWNER,
    })
  })

  it('falls back to the connected wallet address when the step has no fromAddress', async () => {
    await run(
      buildContext({
        step: {
          action: {},
          estimate: {
            approvalAddress: '0x2222222222222222222222222222222222222222',
          },
        },
      } as unknown as Partial<EthereumStepExecutorContext>)
    )
    expect(canAccountUsePermit2).toHaveBeenCalledWith(expect.anything(), {
      chainId: CHAIN_ID,
      address: OWNER,
    })
  })

  it('is NOT supported when no signer address can be determined', async () => {
    const context = buildContext({
      ethereumClient: {} as never,
      step: {
        action: {},
        estimate: {
          approvalAddress: '0x2222222222222222222222222222222222222222',
        },
      },
    } as unknown as Partial<EthereumStepExecutorContext>)
    expect(await run(context)).toBe(false)
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })
})

describe('resolvePermit2Support — memoization across the pipeline', () => {
  it('resolves the signer once per execution so allowance and sign tasks cannot disagree', async () => {
    // TaskPipeline threads one context object through every task. If each task
    // re-resolved independently, a mid-flight delegation could make
    // CheckAllowance approve Permit2 while SignAndExecute skips it, leaving
    // the diamond without an allowance.
    const context = buildContext()

    const first = await run(context)
    const second = await run(context)
    const third = await run(context)

    expect([first, second, third]).toEqual([true, true, true])
    expect(canAccountUsePermit2).toHaveBeenCalledTimes(1)
    await expect(context.permit2SignerSupported).resolves.toBe(true)
  })

  it('honours a signer verdict already present on the context without re-querying', async () => {
    const context = buildContext({
      permit2SignerSupported: Promise.resolve(false),
    })
    expect(await run(context)).toBe(false)
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('memoizes a negative verdict too — the case a truthiness check would silently re-query', async () => {
    // The reason this field holds a promise rather than a `boolean`: with
    // `boolean | undefined`, `false` and "not looked up yet" are the same
    // under `!context.permit2SignerSupported`, so a plausible future edit
    // would re-resolve on every task and let the answer change mid-swap.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)
    const context = buildContext()

    expect(await run(context)).toBe(false)
    expect(await run(context)).toBe(false)

    expect(canAccountUsePermit2).toHaveBeenCalledTimes(1)
  })
})

describe('resolvePermit2Support — step/chain gate short-circuits before the RPC', () => {
  const cases: Array<[string, Partial<EthereumStepExecutorContext>]> = [
    ['the chain has no Permit2', { fromChain: { id: CHAIN_ID } as never }],
    [
      'the chain has no Permit2 proxy',
      {
        fromChain: {
          id: CHAIN_ID,
          permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        } as never,
      },
    ],
    ['the source token is native', { isFromNativeToken: true }],
    ['message signing is disabled', { disableMessageSigning: true }],
    [
      'there is no approval address',
      { step: { action: { fromAddress: OWNER }, estimate: {} } as never },
    ],
    [
      'the step skips approval',
      {
        step: {
          action: { fromAddress: OWNER },
          estimate: { approvalAddress: OWNER, skipApproval: true },
        } as never,
      },
    ],
    [
      'the step skips permits',
      {
        step: {
          action: { fromAddress: OWNER },
          estimate: { approvalAddress: OWNER, skipPermit: true },
        } as never,
      },
    ],
  ]

  it.each(cases)(
    'returns false and issues no RPC when %s',
    async (_, overrides) => {
      expect(await run(buildContext(overrides))).toBe(false)
      expect(canAccountUsePermit2).not.toHaveBeenCalled()
    }
  )

  it('returns false and issues no RPC for the batched strategy', async () => {
    expect(await run(buildContext(), 'batched')).toBe(false)
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })
})

describe('resolvePermit2Support — the probe gates the standard flow only', () => {
  it('keeps a relayed step on Permit2 even when the signer would fail the probe', async () => {
    // The relayer pulls the user's tokens through Permit2 using typed data the
    // API supplied. `signPermit2Message` has one call site and it is in the
    // standard sign task, so the SDK never produces that signature here — and a
    // relayed step has no approve + execute fallback. A probe verdict therefore
    // has nothing to steer, and letting it move the spender to
    // `approvalAddress` leaves the relayer unable to pull: the transfer fails
    // for missing allowance and the user paid for a useless approval.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)

    expect(await run(buildContext(), 'relayed')).toBe(true)
  })

  it('issues no signer RPC for a relayed step', async () => {
    await run(buildContext(), 'relayed')

    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('leaves the memoized verdict unset for a relayed step', async () => {
    // The guard returns before the memo slot is touched, so a later standard
    // step in the same execution still resolves the signer for itself.
    const context = buildContext()

    await run(context, 'relayed')

    expect(context.permit2SignerSupported).toBeUndefined()
  })

  it('still applies the step/chain checks to a relayed step', async () => {
    // Regression guard: the strategy guard must not become a blanket `true`. A
    // native from-token can never use Permit2, whoever signs.
    expect(
      await run(buildContext({ isFromNativeToken: true }), 'relayed')
    ).toBe(false)
  })
})
