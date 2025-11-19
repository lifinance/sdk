import type { ExtendedChain } from '@lifi/types'
import type { Address, Client } from 'viem'
import { readContract } from 'viem/actions'
import type { SDKClient } from '../../../types/core.js'
import { permit2ProxyAbi } from '../abi.js'
import { getActionWithFallback } from '../getActionWithFallback.js'
import type { PermitTransferFrom } from './signatureTransfer.js'

export const getPermitTransferFromValues = async (
  client: SDKClient,
  viemClient: Client,
  chain: ExtendedChain,
  tokenAddress: Address,
  amount: bigint
): Promise<PermitTransferFrom> => {
  const nonce = await getActionWithFallback(
    client,
    viemClient,
    readContract,
    'readContract',
    {
      address: chain.permit2Proxy as Address,
      abi: permit2ProxyAbi,
      functionName: 'nextNonce' as const,
      args: [viemClient.account!.address] as const,
    }
  )

  return {
    permitted: {
      token: tokenAddress,
      amount: amount,
    },
    spender: chain.permit2Proxy as Address,
    nonce: nonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60), // 30 minutes
  }
}
