import type { ExtendedChain } from '@lifi/types'
import type { Address, Client, Hex } from 'viem'
import { keccak256 } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getPermitTransferFromValues } from './getPermitTransferFromValues.js'
import {
  type PermitBatchTransferFrom,
  type PermitBatchTransferFromData,
  type PermitTransferFrom,
  type PermitTransferFromData,
  getPermitData,
} from './signatureTransfer.js'
import type { Permit2Signature } from './types.js'

export interface SignPermit2MessageParams {
  client: Client
  chain: ExtendedChain
  tokenAddress: Address
  amount: bigint
  data: Hex
  witness?: boolean
}

export interface SignPermit2SingleParams extends SignPermit2MessageParams {
  permitData?: PermitTransferFromData
}

export interface SignPermit2BatchParams extends SignPermit2MessageParams {
  permitData?: PermitBatchTransferFromData
}

export function signPermit2Message(
  params: SignPermit2SingleParams
): Promise<Permit2Signature<PermitTransferFrom>>
export function signPermit2Message(
  params: SignPermit2BatchParams
): Promise<Permit2Signature<PermitBatchTransferFrom>>
export async function signPermit2Message(
  params: SignPermit2SingleParams | SignPermit2BatchParams
): Promise<Permit2Signature<PermitTransferFrom | PermitBatchTransferFrom>> {
  const { client, chain, tokenAddress, amount, data, permitData, witness } =
    params

  let _permitData = permitData
  if (!_permitData) {
    const permitTransferFrom = await getPermitTransferFromValues(
      client,
      chain,
      tokenAddress,
      amount
    )

    // Create witness data for the LI.FI call
    const _witness = witness
      ? {
          witness: {
            diamondAddress: chain.diamondAddress as Address,
            diamondCalldataHash: keccak256(data),
          },
          witnessTypeName: 'LiFiCall',
          witnessType: {
            LiFiCall: [
              { name: 'diamondAddress', type: 'address' },
              { name: 'diamondCalldataHash', type: 'bytes32' },
            ],
          },
        }
      : undefined

    _permitData = getPermitData(
      permitTransferFrom,
      chain.permit2 as Address,
      chain.id,
      _witness
    )
  }

  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    primaryType: witness ? 'PermitWitnessTransferFrom' : 'PermitTransferFrom',
    domain: _permitData.domain,
    types: _permitData.types,
    message: _permitData.values,
  })

  return {
    signature,
    values: _permitData.values,
  }
}
