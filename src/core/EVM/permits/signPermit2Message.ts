import type { ExtendedChain, SignedTypedData } from '@lifi/types'
import type { Address, Client, Hex } from 'viem'
import { keccak256 } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getPermitTransferFromValues } from './getPermitTransferFromValues.js'
import { getPermitData } from './signatureTransfer.js'

interface SignPermit2MessageParams {
  client: Client
  chain: ExtendedChain
  tokenAddress: Address
  amount: bigint
  data: Hex
  witness?: boolean
}

export async function signPermit2Message(
  params: SignPermit2MessageParams
): Promise<SignedTypedData> {
  const { client, chain, tokenAddress, amount, data, witness } = params

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

  const permitData = getPermitData(
    permitTransferFrom,
    chain.permit2 as Address,
    chain.id,
    _witness
  )

  const primaryType = witness
    ? 'PermitWitnessTransferFrom'
    : 'PermitTransferFrom'

  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    primaryType,
    domain: permitData.domain,
    types: permitData.types,
    message: permitData.message,
  })

  return {
    ...permitData,
    primaryType,
    signature,
  }
}
