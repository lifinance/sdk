import type { Address, WalletClient } from 'viem'
import { createWalletClient, http, publicActions } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../tests/setup'
import { revokeTokenApproval, setTokenAllowance } from './setAllowance'

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

describe.skipIf(!MNEMONIC)('Approval integration tests', () => {
  if (!MNEMONIC) {
    return
  }

  const account = mnemonicToAccount(MNEMONIC as Address)
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  })

  const client = walletClient.extend(publicActions)

  beforeAll(setupTestEnvironment)

  it(
    'should revoke allowance for ERC20 on POL',
    async () => {
      const revokeTxHash = await revokeTokenApproval({
        walletClient,
        token: testToken,
        spenderAddress: defaultSpenderAddress,
      })

      if (revokeTxHash) {
        const transactionReceipt = await client.waitForTransactionReceipt({
          hash: revokeTxHash!,
        })

        expect(transactionReceipt.status).toBe('success')
      }
    },
    { timeout }
  )

  it(
    'should set allowance ERC20 on POL',
    async () => {
      const approvalTxHash = await setTokenAllowance({
        walletClient,
        token: testToken,
        spenderAddress: defaultSpenderAddress,
        amount: defaultAllowance,
      })

      if (approvalTxHash) {
        const transactionReceipt = await client.waitForTransactionReceipt({
          hash: approvalTxHash!,
        })

        expect(transactionReceipt.status).toBe('success')
      }
    },
    { timeout }
  )
})
