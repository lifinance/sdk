import { ChainId } from '@lifi/types'
import { Connection } from '@solana/web3.js'
import { getRpcUrl } from '../utils.js'

const solanaChainProvider: Connection | undefined = undefined

/**
 * getSolanaConnection is just a thin wrapper around getting the
 * connection (rpc provider) for Solana
 * @returns - Solana rpc connection
 */
export const getSolanaConnection = async (): Promise<Connection> => {
  if (!solanaChainProvider) {
    const rpcUrl = await getRpcUrl(ChainId.SOL)
    return new Connection(rpcUrl)
  } else {
    return solanaChainProvider
  }
}
