import type {
  ExtendedChain,
  LiFiStepExtended,
  SDKClient,
  SignedTypedData,
  TypedData,
} from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getRelayerQuote: vi.fn(),
    getStepTransaction: vi.fn(),
    getContractCallsQuote: vi.fn(),
  }
})

import { getRelayerQuote, getStepTransaction } from '@lifi/sdk'
import { getUpdatedStep } from './getUpdatedStep.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
// A caller's own spender. NOT `PERMIT2`, which would make the entry a relayer
// intent whatever its primary type.
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const chain = { id: SOURCE_CHAIN, permit2: PERMIT2 } as unknown as ExtendedChain

const witness = (): TypedData =>
  ({
    primaryType: 'PermitWitnessTransferFrom',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: {},
  }) as unknown as TypedData

/**
 * A `PermitSingle` whose spender is the Permit2 deployment. Its primary type is
 * on the caller-intent allowlist, so the ONLY thing that makes it a relayer
 * intent is the spender rule — the rule `isGaslessStep` cannot apply without a
 * chain.
 */
const permit2SpenderIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: PERMIT2 },
  }) as unknown as TypedData

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const buildStep = (typedData: TypedData[]): LiFiStepExtended =>
  ({
    type: 'lifi',
    id: 'step-1',
    tool: 'uniswap',
    action: {
      fromChainId: SOURCE_CHAIN,
      toChainId: SOURCE_CHAIN,
      fromAddress: FROM_ADDRESS,
      fromAmount: '1000000',
      slippage: 0.03,
      fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      toToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
    },
    estimate: { approvalAddress: PERMIT2, gasCosts: [], feeCosts: [] },
    // Read by `isContractCallStep`, which runs before the lane question.
    includedSteps: [],
    typedData,
  }) as unknown as LiFiStepExtended

const client = {} as SDKClient

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRelayerQuote).mockResolvedValue({
    id: 'relayer-step',
  } as never)
  vi.mocked(getStepTransaction).mockResolvedValue({
    id: 'standard-step',
  } as never)
})

describe('getUpdatedStep', () => {
  it('re-quotes a gasless witness step through the relayer', async () => {
    await getUpdatedStep(client, buildStep([witness()]), chain)

    expect(getRelayerQuote).toHaveBeenCalledTimes(1)
    expect(getStepTransaction).not.toHaveBeenCalled()
  })

  it('re-quotes a step whose only relayer marker is the Permit2 spender through the relayer', async () => {
    // The chain is what makes this answerable. `getEthereumExecutionStrategy`
    // routes this shape to `relayed` because it passes the chain to the
    // classifier; asking the question here without one sends the step to
    // `/advanced/stepTransaction` instead — the wrong endpoint for the
    // strategy that will run.
    await getUpdatedStep(client, buildStep([permit2SpenderIntent()]), chain)

    expect(getRelayerQuote).toHaveBeenCalledTimes(1)
    expect(getStepTransaction).not.toHaveBeenCalled()
  })

  it('re-quotes a caller-intent step through /advanced/stepTransaction', async () => {
    // The control. Without it the two cases above would also pass if every
    // step went to the relayer.
    const signedTypedData = [
      { ...callerIntent(), signature: SIGNATURE },
    ] as unknown as SignedTypedData[]

    await getUpdatedStep(
      client,
      buildStep([callerIntent()]),
      chain,
      undefined,
      signedTypedData
    )

    expect(getStepTransaction).toHaveBeenCalledTimes(1)
    expect(getRelayerQuote).not.toHaveBeenCalled()
    // The unsigned declaration is stripped and the signed entries take its
    // place, which is what embeds the signature in the router calldata.
    expect(vi.mocked(getStepTransaction).mock.calls[0][1]).toMatchObject({
      typedData: signedTypedData,
    })
  })
})
