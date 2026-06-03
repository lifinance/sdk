export const fetchTxErrorDetails = async (
  txHash: string,
  chainId: number
): Promise<unknown> => {
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
