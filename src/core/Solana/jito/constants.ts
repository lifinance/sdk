import type { Cluster } from '@solana/web3.js'

// Jito Tip accounts gotten from https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses
export const JITO_TIP_ACCOUNTS: Record<Cluster, string[]> = {
  'mainnet-beta': [
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  ],
  devnet: [],
  testnet: [
    'BkMx5bRzQeP6tUZgzEs3xeDWJfQiLYvNDqSgmGZKYJDq',
    'CwWZzvRgmxj9WLLhdoWUVrHZ1J8db3w2iptKuAitHqoC',
    '4uRnem4BfVpZBv7kShVxUYtcipscgZMSHi3B9CSL6gAA',
    'AzfhMPcx3qjbvCK3UUy868qmc5L451W341cpFqdL3EBe',
    '84DrGKhycCUGfLzw8hXsUYX9SnWdh2wW3ozsTPrC5xyg',
    '7aewvu8fMf1DK4fKoMXKfs3h3wpAQ7r7D8T1C71LmMF',
    'G2d63CEgKBdgtpYT2BuheYQ9HFuFCenuHLNyKVpqAuSD',
    'F7ThiQUBYiEcyaxpmMuUeACdoiSLKg4SZZ8JSfpFNwAf',
  ],
}
