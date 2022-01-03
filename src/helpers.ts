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

/**
 * Predefined hook that decrypts calldata using EIP-1193 compliant wallet functions.
 * @param {string} walletAddress - The wallet address of the user that should decrypt the calldata.
 * @return {(encryptedData: string) => Promise<any>} A function that decrypts data using EIP-1193 compliant wallet functions.
 */
export const getEthereumDecyptionHook = (walletAddress: string) => {
  return (encryptedData: string) => {
    return ethereumRequest('eth_decrypt', [encryptedData, walletAddress])
  }
}

/**
 * Predefined hook that get the public encryption key of a user using EIP-1193 compliant wallet functions.
 * @param {string} walletAddress - The wallet address of the user.
 * @return {(walletAddress: string) => () => Promise<any>} A function that return the public encryption key using EIP-1193 compliant wallet functions.
 */
export const getEthereumPublicKeyHook = (walletAddress: string) => {
  return () => {
    return ethereumRequest('eth_getEncryptionPublicKey', [walletAddress])
  }
}
