import type {
  Account,
  Chain,
  Client,
  PublicActions,
  RpcSchema,
  Transport,
  WalletActions,
} from 'viem'
import { getAction } from 'viem/utils'
import { getPublicClient } from './publicClient.js'

/**
 * Executes an action with a fallback to public client if the wallet client fails due to rate limiting
 * or similar recoverable errors.
 *
 * Note: Only falls back to public client if the initial client was a wallet client (has an account address).
 * If the initial client was already a public client, no fallback will occur.
 *
 * @param walletClient - The wallet client to use primarily
 * @param action - The function or method to execute
 * @param actionName - The name of the action (used for error handling)
 * @param params - The parameters for the action
 * @returns The result of the action
 */
export const getActionWithFallback = async <
  transport extends Transport,
  chain extends Chain | undefined,
  account extends Account | undefined,
  rpcSchema extends RpcSchema | undefined,
  extended extends { [key: string]: unknown },
  client extends Client<transport, chain, account, rpcSchema, extended>,
  parameters,
  returnType,
>(
  walletClient: client,
  actionFn: (_: client, parameters: parameters) => returnType,
  name: keyof PublicActions | keyof WalletActions | (string & {}),
  params: parameters
): Promise<Awaited<returnType>> => {
  try {
    return await getAction(walletClient, actionFn, name)(params)
  } catch (error: unknown) {
    // Only fall back if this was a wallet client (has an account address)
    // If it was already a public client, we don't want to fall back
    if (!walletClient.account?.address) {
      throw error
    }

    const chainId = walletClient.chain?.id
    if (!chainId) {
      throw error
    }

    const publicClient = await getPublicClient(chainId)
    return await getAction(publicClient, actionFn, name)(params)
  }
}
