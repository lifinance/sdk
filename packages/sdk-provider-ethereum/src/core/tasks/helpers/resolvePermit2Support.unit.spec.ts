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
    // `EthereumStepExecutor.createContext` always sets this, and the caller-intent
    // gate reads it. Omitting it made the fixture disagree with production.
    signedTypedData: [],
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

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const SIGNATURE = `0x${'11'.repeat(65)}`

const typedDataEntry = (primaryType: string, spender?: string) => ({
  primaryType,
  domain: { chainId: CHAIN_ID, verifyingContract: PERMIT2 },
  types: {},
  message: spender ? { spender } : {},
})

// A relayed step ALWAYS carries typed data — `isRelayerStep` requires it. The
// old fixture omitted it, which is why a gate that keys off typed data could
// regress without failing a test.
//
// Takes the same overrides bag as `buildContext`, so the relayed tests keep the
// file's existing style: pass overrides in, never mutate the context afterwards.
const buildGaslessContext = (
  overrides: Partial<EthereumStepExecutorContext> = {}
): EthereumStepExecutorContext =>
  buildContext({
    step: {
      action: { fromAddress: OWNER },
      estimate: {
        approvalAddress: '0x2222222222222222222222222222222222222222',
      },
      typedData: [typedDataEntry('PermitWitnessTransferFrom')],
    },
    ...overrides,
  } as unknown as Partial<EthereumStepExecutorContext>)

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
    // A 7702-delegated EOA passes every step/chain check, but Permit2 may still
    // reject it via EIP-1271 — so a `false` verdict must approve + execute.
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
    // Moving the spender to `approvalAddress` leaves the relayer unable to pull
    // through Permit2: the transfer fails and the approval was wasted.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)

    expect(await run(buildGaslessContext(), 'relayed')).toBe(true)
  })

  it('issues no signer RPC for a relayed step', async () => {
    await run(buildGaslessContext(), 'relayed')

    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('leaves the memoized verdict unset for a relayed step', async () => {
    // The guard returns before the memo write, so a later standard step in the
    // same execution still resolves the signer for itself.
    const context = buildGaslessContext()

    await run(context, 'relayed')

    expect(context.permit2SignerSupported).toBeUndefined()
  })

  it('still applies the step/chain checks to a relayed step', async () => {
    // Regression guard: the strategy guard must not become a blanket `true`. A
    // native from-token can never use Permit2, whoever signs.
    expect(
      await run(buildGaslessContext({ isFromNativeToken: true }), 'relayed')
    ).toBe(false)
  })
})

describe('resolvePermit2Support — caller-supplied Permit2 intents', () => {
  const buildCallerIntentContext = (): EthereumStepExecutorContext =>
    buildContext({
      step: {
        action: { fromAddress: OWNER },
        estimate: { approvalAddress: PERMIT2 },
        typedData: [typedDataEntry('PermitSingle', UNIVERSAL_ROUTER)],
      },
    } as unknown as Partial<EthereumStepExecutorContext>)

  it('turns the gate off, so the SDK does not wrap the step in its own Permit2 flow', async () => {
    expect(await run(buildCallerIntentContext())).toBe(false)
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('turns the gate off for the relayed strategy too', async () => {
    expect(await run(buildCallerIntentContext(), 'relayed')).toBe(false)
  })

  it('keeps the gate OFF when the API erased the declaration but the intent was signed', async () => {
    // The sibling of the native-permit hole. `EthereumPrepareTransactionTask`
    // overwrites `step.typedData` with `updatedStep.typedData ?? step.typedData`,
    // and an explicit `typedData: []` from the API is not nullish, so it wins
    // and erases the declaration. Reading only the declaration would reopen this
    // gate and wrap the caller's calldata in `encodePermit2Data`, then retarget
    // the transaction to `permit2Proxy` — the same destruction the native-permit
    // branch was fixed for.
    const context = buildContext({
      step: {
        action: { fromAddress: OWNER },
        estimate: { approvalAddress: PERMIT2 },
        typedData: [],
      },
      signedTypedData: [
        {
          ...typedDataEntry('PermitSingle', UNIVERSAL_ROUTER),
          signature: SIGNATURE,
        },
      ],
    } as unknown as Partial<EthereumStepExecutorContext>)

    expect(await run(context)).toBe(false)
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('keeps the gate ON for a step carrying both a witness intent and a caller intent', async () => {
    // The lanes are not mutually exclusive. The relayer still pulls through
    // Permit2 here, so moving the spender to approvalAddress would revert it.
    const context = buildContext({
      step: {
        action: { fromAddress: OWNER },
        estimate: { approvalAddress: PERMIT2 },
        typedData: [
          typedDataEntry('PermitWitnessTransferFrom'),
          typedDataEntry('PermitSingle', UNIVERSAL_ROUTER),
        ],
      },
    } as unknown as Partial<EthereumStepExecutorContext>)

    expect(await run(context, 'relayed')).toBe(true)
  })

  it('keeps the gate ON for a mixed-lane step under the standard strategy too', async () => {
    // The exemption is keyed on the lane, not on the strategy: a mixed-lane
    // step keeps LI.FI's Permit2 flow whichever way it is later executed.
    const context = buildContext({
      step: {
        action: { fromAddress: OWNER },
        estimate: { approvalAddress: PERMIT2 },
        typedData: [
          typedDataEntry('PermitWitnessTransferFrom'),
          typedDataEntry('PermitSingle', UNIVERSAL_ROUTER),
        ],
      },
    } as unknown as Partial<EthereumStepExecutorContext>)

    expect(await run(context)).toBe(true)
    expect(canAccountUsePermit2).toHaveBeenCalled()
  })
})
