import { ChainType, type ExtendedChain } from '@lifi/types'
import type { Address } from 'viem'
import type { SDKClient } from '../types.js'
import { getActionWithFallback } from './getActionWithFallback.js'
import { getAllowance } from './getAllowance.js'
import { getNativePermit } from './permits/getNativePermit.js'
import { getPublicClient } from './publicClient.js'
import type { EVMProvider } from './types.js'

type PermitSupport = {
  /** Whether the token supports EIP-2612 native permits */
  nativePermitSupported: boolean
  /** Whether Permit2 is available and has sufficient allowance */
  permit2AllowanceSufficient: boolean
}

/**
 * Checks what permit types are supported for a token on a specific chain.
 * Checks in order:
 * 1. Native permit (EIP-2612) support
 * 2. Permit2 availability and allowance
 *
 * @param client - The SDK client
 * @param chain - The chain to check permit support on
 * @param tokenAddress - The token address to check
 * @param ownerAddress - The address that would sign the permit
 * @param amount - The amount to check allowance against for Permit2
 * @returns Object indicating which permit types are supported
 */
export const checkPermitSupport = async (
  client: SDKClient,
  {
    chain,
    tokenAddress,
    ownerAddress,
    amount,
  }: {
    chain: ExtendedChain
    tokenAddress: Address
    ownerAddress: Address
    amount: bigint
  }
): Promise<PermitSupport> => {
  const provider = client.getProvider(ChainType.EVM) as EVMProvider | undefined
  let viemClient = await provider?.getWalletClient?.()

  if (!viemClient) {
    viemClient = await getPublicClient(client, chain.id)
  }

  const nativePermit = await getActionWithFallback(
    client,
    viemClient,
    getNativePermit,
    'getNativePermit',
    {
      client,
      viemClient,
      chainId: chain.id,
      tokenAddress,
      spenderAddress: chain.permit2Proxy as Address,
      amount,
    }
  )

  let permit2Allowance: bigint | undefined
  // Check Permit2 allowance if available on chain
  if (chain.permit2) {
    permit2Allowance = await getAllowance(
      client,
      viemClient,
      tokenAddress,
      ownerAddress,
      chain.permit2 as Address
    )
  }

  return {
    nativePermitSupported: !!nativePermit,
    permit2AllowanceSufficient:
      !!permit2Allowance && permit2Allowance >= amount,
  }
}
