import { ChainId } from '@lifi/types'
import { Connection } from '@solana/web3.js'
import { getRpcUrl } from '../rpc.js'

let connection: Connection | undefined = undefined

/**
 * getSolanaConnection is just a thin wrapper around getting the connection (RPC provider) for Solana
 * @returns - Solana RPC connection
 */
export const getSolanaConnection = async (): Promise<Connection> => {
  if (!connection) {
    const rpcUrl = await getRpcUrl(ChainId.SOL)
    connection = new Connection(rpcUrl)
    return connection
  } else {
    return connection
  }
}
