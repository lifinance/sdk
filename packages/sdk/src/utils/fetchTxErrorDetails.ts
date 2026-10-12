import { isHex } from './isHex.js'

// `0x` plus 64 hex characters: a 32-byte EVM transaction hash.
const TX_HASH_LENGTH = 66

export const fetchTxErrorDetails = async (
  txHash: string,
  chainId: number
): Promise<unknown> => {
  // Both values go into the Tenderly URL path. Accept only an EVM transaction
  // hash and a real chain ID, and send no request for anything else.
  if (
    !isHex(txHash) ||
    txHash.length !== TX_HASH_LENGTH ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0
  ) {
    return undefined
  }

  try {
    const response = await fetch(
      `https://api.tenderly.co/api/v1/public-contract/${chainId}/tx/${txHash}`
    )
    const reponseBody = await response.json()

    return reponseBody
  } catch (_) {
    return undefined
  }
}
