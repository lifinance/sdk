import type { SDKClient } from '@lifi/sdk'
import type { Client } from 'viem'
import { getAccountCode } from '../actions/getAccountCode.js'
import { isSmartContractWalletCode } from '../actions/isSmartContractWallet.js'

/**
 * Whether the account can use native EIP-2612 permits — true for EOAs and
 * EIP-7702 delegated EOAs (both produce ECDSA signatures), false for
 * smart-contract wallets. Conservatively false on missing chain id or RPC
 * failure ("if unsure, don't use permits").
 */
export const canAccountUseNativePermits = async (
  client: SDKClient,
  viemClient: Client
): Promise<boolean> => {
  const chainId = viemClient.chain?.id
  if (chainId === undefined) {
    return false
  }
  const code = await getAccountCode({
    client,
    chainId,
    address: viemClient.account!.address,
  })
  // Load-bearing: without this guard, `!isSmartContractWalletCode(undefined)`
  // would flip RPC failure from "no permits" to "use permits" (regression).
  if (code === undefined) {
    return false
  }
  return !isSmartContractWalletCode(code)
}
