import type { LiFiStep, SignedTypedData, TypedData } from '@lifi/sdk'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return {
    ...actual,
    sendTransaction: vi.fn(),
  }
})

vi.mock('../../actions/resolveTransactionHash.js', () => ({
  resolveTransactionHash: vi.fn(),
}))

vi.mock('../../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))

vi.mock('../../permits/signPermit2Message.js', () => ({
  signPermit2Message: vi.fn(),
}))

vi.mock('../../permits/encodePermit2Data.js', () => ({
  encodePermit2Data: vi.fn(),
}))

vi.mock('../../permits/encodeNativePermitData.js', () => ({
  encodeNativePermitData: vi.fn(),
}))

vi.mock('./helpers/estimateTransactionRequest.js', () => ({
  estimateTransactionRequest: vi.fn(),
}))

import { sendTransaction } from 'viem/actions'
import { resolveTransactionHash } from '../../actions/resolveTransactionHash.js'
import { canAccountUsePermit2 } from '../../permits/canAccountUsePermit2.js'
import { encodeNativePermitData } from '../../permits/encodeNativePermitData.js'
import { encodePermit2Data } from '../../permits/encodePermit2Data.js'
import { signPermit2Message } from '../../permits/signPermit2Message.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'
import { estimateTransactionRequest } from './helpers/estimateTransactionRequest.js'

const SOURCE_CHAIN = 1
const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN_ADDRESS = '0xcccc000000000000000000000000000000000003' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const PERMIT2_PROXY = '0xdddd000000000000000000000000000000000004' as Address
// The caller's own spender. NOT `PERMIT2`: a message whose spender is the
// Permit2 deployment classifies as a relayer intent whatever its primary type,
// and every test below would then be exercising the wrong lane.
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
const ROUTER_CALLDATA = '0xdeadbeef' as Hex
const WRAPPED_CALLDATA = '0xfeedface' as Hex
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

const callerIntent = (): TypedData =>
  ({
    primaryType: 'PermitSingle',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: PERMIT2 },
    types: {},
    message: { spender: UNIVERSAL_ROUTER },
  }) as unknown as TypedData

const signedCallerIntent = (): SignedTypedData =>
  ({ ...callerIntent(), signature: SIGNATURE }) as unknown as SignedTypedData

/** A native permit `findSignedNativePermit` would genuinely accept. */
const signedNativePermit = (): SignedTypedData =>
  ({
    primaryType: 'Permit',
    domain: { chainId: SOURCE_CHAIN, verifyingContract: TOKEN_ADDRESS },
    types: {},
    message: {
      owner: FROM_ADDRESS,
      spender: PERMIT2_PROXY,
      value: '1000000',
      nonce: '0',
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
    signature: SIGNATURE,
  }) as unknown as SignedTypedData

const buildContext = (options?: {
  stepTypedData?: TypedData[]
  signedTypedData?: SignedTypedData[]
}): EthereumStepExecutorContext =>
  ({
    step: {
      type: 'lifi',
      id: 'step-1',
      tool: 'uniswap',
      action: {
        fromChainId: SOURCE_CHAIN,
        fromAddress: FROM_ADDRESS,
        fromAmount: '1000000',
        fromToken: { address: TOKEN_ADDRESS, chainId: SOURCE_CHAIN },
      },
      // Every clause of the Permit2 gate is armed, so a test that sees no
      // Permit2 wrap sees it because of the lane, not because the gate was
      // never open.
      estimate: {
        approvalAddress: PERMIT2,
        gasCosts: [],
        feeCosts: [],
      },
      ...(options?.stepTypedData ? { typedData: options.stepTypedData } : {}),
    } as unknown as LiFiStep,
    client: {},
    fromChain: {
      id: SOURCE_CHAIN,
      permit2: PERMIT2,
      permit2Proxy: PERMIT2_PROXY,
      metamask: {
        chainName: 'Ethereum',
        blockExplorerUrls: ['https://etherscan.io/'],
        rpcUrls: ['https://eth.example'],
      },
    },
    isFromNativeToken: false,
    disableMessageSigning: false,
    isBridgeExecution: false,
    allowUserInteraction: true,
    statusManager: {
      findAction: vi.fn().mockReturnValue({ type: 'SWAP' }),
      updateAction: vi.fn(),
    },
    // The client stub must not carry its own sendTransaction method so
    // getAction falls through to the mocked viem action.
    checkClient: vi.fn().mockResolvedValue({
      account: { address: FROM_ADDRESS },
    }),
    ethereumClient: { account: { address: FROM_ADDRESS } },
    transactionRequest: {
      chainId: SOURCE_CHAIN,
      from: FROM_ADDRESS,
      to: UNIVERSAL_ROUTER,
      data: ROUTER_CALLDATA,
    },
    signedTypedData: options?.signedTypedData ?? [],
  }) as unknown as EthereumStepExecutorContext

const task = new EthereumStandardSignAndExecuteTask()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendTransaction).mockResolvedValue(TX_HASH)
  vi.mocked(resolveTransactionHash).mockResolvedValue(TX_HASH)
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
  vi.mocked(signPermit2Message).mockResolvedValue({
    message: { nonce: 1n, deadline: 2n },
    signature: SIGNATURE,
  } as never)
  vi.mocked(encodePermit2Data).mockReturnValue(WRAPPED_CALLDATA)
  vi.mocked(encodeNativePermitData).mockReturnValue(WRAPPED_CALLDATA)
  vi.mocked(estimateTransactionRequest).mockImplementation(
    async (_client, _viemClient, request) => request
  )
})

describe('EthereumStandardSignAndExecuteTask.run', () => {
  it('sends a caller-intent transaction to the API target with the calldata untouched', async () => {
    // The headline guarantee. `/advanced/stepTransaction` already embedded the
    // caller's signature in this calldata, so both SDK wraps must stay off:
    // `encodeNativePermitData` and `encodePermit2Data` would corrupt it and
    // `permit2Proxy` is the wrong contract to send it to.
    const context = buildContext({
      stepTypedData: [callerIntent()],
      signedTypedData: [signedNativePermit(), signedCallerIntent()],
    })

    const result = await task.run(context)

    expect(result.status).toBe('COMPLETED')
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: UNIVERSAL_ROUTER,
        data: ROUTER_CALLDATA,
      })
    )
    expect(encodeNativePermitData).not.toHaveBeenCalled()
    expect(encodePermit2Data).not.toHaveBeenCalled()
    expect(signPermit2Message).not.toHaveBeenCalled()
    expect(estimateTransactionRequest).not.toHaveBeenCalled()
    // The gate is refused on the lane alone, before it costs an eth_getCode.
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
  })

  it('holds that guarantee when only the signed record still shows the caller intent', async () => {
    // `step.typedData: []` is the shape the API answers with. G1 keeps the
    // declaration, and the signed record is the second, independent source.
    const context = buildContext({
      stepTypedData: [],
      signedTypedData: [signedNativePermit(), signedCallerIntent()],
    })

    await task.run(context)

    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: UNIVERSAL_ROUTER,
        data: ROUTER_CALLDATA,
      })
    )
    expect(encodeNativePermitData).not.toHaveBeenCalled()
    expect(encodePermit2Data).not.toHaveBeenCalled()
  })

  it('still wraps and retargets a native permit when no caller intent is in flight', async () => {
    // The control. Without it the test above could pass because the
    // native-permit machinery is simply not armed in this fixture.
    const context = buildContext({
      signedTypedData: [signedNativePermit()],
    })

    await task.run(context)

    expect(encodeNativePermitData).toHaveBeenCalled()
    expect(estimateTransactionRequest).toHaveBeenCalled()
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: PERMIT2_PROXY,
        data: WRAPPED_CALLDATA,
      })
    )
  })

  it('still signs and wraps a Permit2 message when no caller intent is in flight', async () => {
    // The second control: the Permit2 arm of the same decision is armed too.
    const context = buildContext()

    await task.run(context)

    expect(signPermit2Message).toHaveBeenCalled()
    expect(encodePermit2Data).toHaveBeenCalled()
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: PERMIT2_PROXY,
        data: WRAPPED_CALLDATA,
      })
    )
  })
})
