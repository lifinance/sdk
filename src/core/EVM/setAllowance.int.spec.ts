import type { Address, Client } from 'viem'
import { createClient, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { polygon } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { createConfig } from '../../createConfig.js'
import { revokeTokenApproval, setTokenAllowance } from './setAllowance.js'
import { retryCount, retryDelay } from './utils.js'

const config = createConfig({ integrator: 'lifi-sdk' })
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
  const client: Client = createClient({
    account,
    chain: polygon,
    transport: http(),
  })

  beforeAll(setupTestEnvironment)

  it(
    'should revoke allowance for ERC20 on POL',
    async () => {
      const revokeTxHash = await revokeTokenApproval({
        config,
        walletClient: client,
        token: testToken,
        spenderAddress: defaultSpenderAddress,
      })

      if (revokeTxHash) {
        const transactionReceipt = await waitForTransactionReceipt(client, {
          hash: revokeTxHash!,
          retryCount,
          retryDelay,
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
        config,
        walletClient: client,
        token: testToken,
        spenderAddress: defaultSpenderAddress,
        amount: defaultAllowance,
      })

      if (approvalTxHash) {
        const transactionReceipt = await waitForTransactionReceipt(client, {
          hash: approvalTxHash!,
          retryCount,
          retryDelay,
        })

        expect(transactionReceipt.status).toBe('success')
      }
    },
    { timeout }
  )
})
