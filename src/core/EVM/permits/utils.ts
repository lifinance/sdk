import type { PermitTransferFromData } from './signatureTransfer.js'

import type {
  PermitData,
  PermitValues,
  PermitWitnessTransferFromValues,
} from '@lifi/types'
import type {} from './signatureTransfer.js'
import type { NativePermitData } from './types.js'

export const prettifyPermit2Data = (
  permitData: PermitData<PermitWitnessTransferFromValues<string>>
): PermitTransferFromData => {
  return {
    ...permitData,
    values: {
      ...permitData.values,
      permitted: {
        ...permitData.values.permitted,
        amount: BigInt(permitData.values.permitted.amount),
      },
      nonce: BigInt(permitData.values.nonce),
      deadline: BigInt(permitData.values.deadline),
    },
  }
}

export const prettifyNativePermitData = (
  permitData: PermitData<PermitValues<string>>
): NativePermitData => {
  return {
    ...permitData,
    values: {
      ...permitData.values,
      value: BigInt(permitData.values.value),
      nonce: BigInt(permitData.values.nonce),
      deadline: BigInt(permitData.values.deadline),
    },
  }
}
