import type { ExtendedChain } from '@lifi/types'
import type { Address, Client, Hex } from 'viem'
import { encodeFunctionData, keccak256, parseSignature } from 'viem'
import { readContract, signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { TransactionParameters } from '../types.js'
import { eip2612Types, permit2ProxyAbi } from './abi.js'
import { type NativePermitData, getNativePermit } from './getNativePermit.js'
import {
  type PermitBatchTransferFromData,
  type PermitTransferFrom,
  type PermitTransferFromData,
  getPermitData,
} from './permit2/signatureTransfer.js'

export interface PermitSignature {
  signature: Hex
  data: Hex
}

export const signNativePermitMessage = async (
  client: Client,
  transactionRequest: TransactionParameters,
  chain: ExtendedChain,
  tokenAddress: Address,
  amount: bigint,
  nativePermit: NativePermitData
): Promise<PermitSignature> => {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60) // 30 minutes

  const domain = {
    name: nativePermit.name,
    version: nativePermit.version,
    chainId: chain.id,
    verifyingContract: tokenAddress,
  }

  const message = {
    owner: client.account!.address,
    spender: chain.permit2Proxy as Address,
    value: amount,
    nonce: nativePermit.nonce,
    deadline,
  }

  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    domain,
    types: eip2612Types,
    primaryType: 'Permit',
    message,
  })

  const { v, r, s } = parseSignature(signature)

  const data = encodeFunctionData({
    abi: permit2ProxyAbi,
    functionName: 'callDiamondWithEIP2612Signature',
    args: [
      tokenAddress,
      amount,
      deadline,
      Number(v),
      r,
      s,
      transactionRequest.data as Hex,
    ],
  })

  return {
    signature,
    data,
  }
}

export const signPermit2Message = async (
  client: Client,
  transactionRequest: TransactionParameters,
  chain: ExtendedChain,
  tokenAddress: Address,
  amount: bigint
) => {
  const nonce = await readContract(client, {
    address: chain.permit2Proxy as Address,
    abi: permit2ProxyAbi,
    functionName: 'nextNonce',
    args: [client.account!.address],
  })

  const permitTransferFrom: PermitTransferFrom = {
    permitted: {
      token: tokenAddress,
      amount: amount,
    },
    spender: chain.permit2Proxy as Address,
    nonce: nonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60), // 30 minutes
  }

  const { domain, types, values } = getPermitData(
    permitTransferFrom,
    chain.permit2 as Address,
    chain.id
  )

  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    primaryType: 'PermitTransferFrom',
    domain,
    types,
    message: { ...values },
  })

  const data = encodeFunctionData({
    abi: permit2ProxyAbi,
    functionName: 'callDiamondWithPermit2',
    args: [
      transactionRequest.data as Hex,
      [
        [tokenAddress, amount],
        permitTransferFrom.nonce,
        permitTransferFrom.deadline,
      ],
      signature as Hex,
    ],
  })

  return {
    signature,
    data,
  }
}

export const signPermit2WitnessMessage = async (
  client: Client,
  transactionRequest: TransactionParameters,
  chain: ExtendedChain,
  tokenAddress: Address,
  amount: bigint,
  permitData?: PermitTransferFromData | PermitBatchTransferFromData
): Promise<PermitSignature> => {
  let _permitData = permitData
  if (!_permitData) {
    const nonce = await readContract(client, {
      address: chain.permit2Proxy as Address,
      abi: permit2ProxyAbi,
      functionName: 'nextNonce',
      args: [client.account!.address],
    })

    const permitTransferFrom: PermitTransferFrom = {
      permitted: {
        token: tokenAddress,
        amount: amount,
      },
      spender: chain.permit2Proxy as Address,
      nonce: nonce,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60), // 30 minutes
    }

    // Create witness data for the LI.FI call
    const witness = {
      witness: {
        diamondAddress: chain.diamondAddress as Address,
        diamondCalldataHash: keccak256(transactionRequest.data as Hex),
      },
      witnessTypeName: 'LiFiCall',
      witnessType: {
        LiFiCall: [
          { name: 'diamondAddress', type: 'address' },
          { name: 'diamondCalldataHash', type: 'bytes32' },
        ],
      },
    }

    _permitData = getPermitData(
      permitTransferFrom,
      chain.permit2 as Address,
      chain.id,
      witness
    )
  }

  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    primaryType: 'PermitWitnessTransferFrom',
    domain: _permitData.domain,
    types: _permitData.types,
    message: { ..._permitData.values },
  })

  const data = encodeFunctionData({
    abi: permit2ProxyAbi,
    functionName: 'callDiamondWithPermit2Witness',
    args: [
      transactionRequest.data as Hex,
      client.account!.address,
      [
        [tokenAddress, amount],
        _permitData.values.nonce,
        _permitData.values.deadline,
      ],
      signature as Hex,
    ],
  })

  return {
    signature,
    data,
  }
}

export const signPermitMessage = async (
  client: Client,
  {
    transactionRequest,
    chain,
    tokenAddress,
    amount,
    nativePermit,
    permitData,
    useWitness = false,
  }: {
    transactionRequest: TransactionParameters
    chain: ExtendedChain
    tokenAddress: Address
    amount: bigint
    nativePermit?: NativePermitData
    permitData?: PermitTransferFromData | PermitBatchTransferFromData
    useWitness?: boolean
  }
): Promise<PermitSignature> => {
  let _nativePermit = nativePermit

  if (!_nativePermit) {
    _nativePermit = await getNativePermit(client, chain, tokenAddress)
  }

  if (_nativePermit.supported) {
    return signNativePermitMessage(
      client,
      transactionRequest,
      chain,
      tokenAddress,
      amount,
      _nativePermit
    )
  }

  if (useWitness) {
    return signPermit2WitnessMessage(
      client,
      transactionRequest,
      chain,
      tokenAddress,
      amount,
      permitData
    )
  }

  return signPermit2Message(
    client,
    transactionRequest,
    chain,
    tokenAddress,
    amount
  )
}
