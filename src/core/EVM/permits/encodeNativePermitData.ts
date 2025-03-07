import type { Address, Hash, Hex } from 'viem'
import { encodeFunctionData, parseSignature } from 'viem'
import { permit2ProxyAbi } from '../abi.js'

export const encodeNativePermitData = (
  tokenAddress: Address,
  amount: bigint,
  deadline: bigint,
  signature: Hash,
  transactionData: Hex
): Hex => {
  const { v, r, s } = parseSignature(signature)
  const data = encodeFunctionData({
    abi: permit2ProxyAbi,
    functionName: 'callDiamondWithEIP2612Signature',
    args: [tokenAddress, amount, deadline, Number(v), r, s, transactionData],
  })
  return data
}
