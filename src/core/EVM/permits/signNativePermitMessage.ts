import type {} from '@lifi/types'
import type { Client } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { NativePermitData, NativePermitSignature } from './types.js'

export const signNativePermitMessage = async (
  client: Client,
  permitData: NativePermitData
): Promise<NativePermitSignature> => {
  const signature = await getAction(
    client,
    signTypedData,
    'signTypedData'
  )({
    account: client.account!,
    domain: permitData.domain,
    types: permitData.types,
    primaryType: 'Permit',
    message: permitData.values,
  })

  return {
    signature,
    values: permitData.values,
  }
}
