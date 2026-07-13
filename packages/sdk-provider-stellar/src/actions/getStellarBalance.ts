import {
  type SDKClient,
  type Token,
  type TokenAmount,
  withDedupe,
} from '@lifi/sdk'
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  rpc,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../client/getStellarRpc.js'

/**
 * Fetches Stellar token balances for a wallet.
 *
 * Every LI.FI Stellar token — including native XLM — is addressed by its Soroban
 * Stellar-Asset-Contract (SAC) `C`-address (see backend EXBE-245). We therefore
 * read each balance uniformly by simulating the SAC `balance(account)` call over
 * Stellar RPC, which works for native XLM, wrapped classic assets, and
 * Soroban-native tokens alike.
 */
export const getStellarBalance = async (
  client: SDKClient,
  walletAddress: string,
  tokens: Token[],
  networkPassphrase: string = Networks.PUBLIC
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }

  const results = await Promise.all(
    tokens.map((token) =>
      withDedupe(
        () => getSacBalance(client, walletAddress, token, networkPassphrase),
        { id: `${getStellarBalance.name}.${walletAddress}.${token.address}` }
      ).catch(() => undefined)
    )
  )

  return tokens.map((token, index) => {
    const amount = results[index]
    return amount !== undefined ? { ...token, amount } : { ...token }
  })
}

/**
 * Simulates a read-only `balance(account)` call on the token's SAC and decodes
 * the returned i128 into a bigint. Returns `undefined` when the balance cannot
 * be read (e.g. contract not found, account not funded).
 */
const getSacBalance = async (
  client: SDKClient,
  walletAddress: string,
  token: Token,
  networkPassphrase: string
): Promise<bigint | undefined> => {
  return callStellarRpcsWithRetry(client, async (server) => {
    // A zero-sequence account is sufficient for read-only simulation.
    const source = new Account(walletAddress, '0')
    const contract = new Contract(token.address)
    const transaction = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call('balance', Address.fromString(walletAddress).toScVal())
      )
      .setTimeout(30)
      .build()

    const simulation = await server.simulateTransaction(transaction)
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      return undefined
    }
    const value = scValToNative(simulation.result.retval)
    return value != null ? BigInt(value) : undefined
  })
}
