import { createClient } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { createClient as createViemClient, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { polygon } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { revokeTokenApproval, setTokenAllowance } from './setAllowance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const retryCount = 30
// Modified viem retryDelay exponential backoff function.
const retryDelay = ({ count }: { count: number; error: Error }) =>
  Math.min(~~(1 << count) * 200, 3000)

const defaultSpenderAddress = '0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF'
const testToken = {
  name: 'USDT',
  symbol: 'USDT',
  decimals: 6,
  address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  chainId: 137,
  priceUSD: '',
}
const defaultAllowance = 10_000_000n // 10$

const timeout = 3600000

const MNEMONIC = ''

describe.skipIf(!MNEMONIC)('Approval integration tests', { timeout }, () => {
  if (!MNEMONIC) {
    return
  }

  const account = mnemonicToAccount(MNEMONIC as Address)
  const walletClient: Client = createViemClient({
    account,
    chain: polygon,
    transport: http(),
  })

  it('should revoke allowance for ERC20 on POL', async () => {
    const revokeTxHash = await revokeTokenApproval(client, {
      walletClient,
      token: testToken,
      spenderAddress: defaultSpenderAddress,
    })

    if (revokeTxHash) {
      const transactionReceipt = await waitForTransactionReceipt(walletClient, {
        hash: revokeTxHash!,
        retryCount,
        retryDelay,
      })

      expect(transactionReceipt.status).toBe('success')
    }
  })

  it('should set allowance ERC20 on POL', async () => {
    const approvalTxHash = await setTokenAllowance(client, {
      walletClient,
      token: testToken,
      spenderAddress: defaultSpenderAddress,
      amount: defaultAllowance,
    })

    if (approvalTxHash) {
      const transactionReceipt = await waitForTransactionReceipt(walletClient, {
        hash: approvalTxHash!,
        retryCount,
        retryDelay,
      })

      expect(transactionReceipt.status).toBe('success')
    }
  })
})
