import type { Address, Hex } from 'viem'
import { encodeFunctionData, type Hash } from 'viem'
import { permit2ProxyAbi } from '../abi.js'

export const encodePermit2Data = (
  tokenAddress: Address,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
  transactionData: Hex,
  signature: Hash,
  accountAddress?: Address,
  witness?: boolean
): Hex => {
  if (witness && accountAddress) {
    const data = encodeFunctionData({
      abi: permit2ProxyAbi,
      functionName: 'callDiamondWithPermit2Witness',
      args: [
        transactionData,
        accountAddress,
        [[tokenAddress, amount], nonce, deadline],
        signature as Hex,
      ],
    })

    return data
  }

  const data = encodeFunctionData({
    abi: permit2ProxyAbi,
    functionName: 'callDiamondWithPermit2',
    args: [
      transactionData,
      [[tokenAddress, amount], nonce, deadline],
      signature as Hex,
    ],
  })

  return data
}
