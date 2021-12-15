declare const ethereum: any

const ethereumRequest = async (
  method: string,
  params: string[]
): Promise<any> => {
  // If ethereum.request() exists, the provider is probably EIP-1193 compliant.
  return await ethereum.request({
    method,
    params,
  })
}

export const getEthereumDecyptionHook = (walletAddress: string) => {
  return (encryptedData: string) => {
    return ethereumRequest('eth_decrypt', [encryptedData, walletAddress])
  }
}

export const getEthereumPublicKeyHook = (walletAddress: string) => {
  return () => {
    return ethereumRequest('eth_getEncryptionPublicKey', [walletAddress])
  }
}
