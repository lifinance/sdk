import { ChainId, CoinKey } from '@lifi/types'
import {
  Keypair,
  VersionedTransaction,
  type BlockheightBasedTransactionConfirmationStrategy,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { beforeAll, describe, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { findDefaultToken } from '../../../tests/tokens.js'
import { getQuote } from '../../services/api.js'
import { getSolanaConnection } from './connection.js'

const fromChain = ChainId.SOL
const toChain = ChainId.POL
const devEvmWallet = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
const devSolanaWallet = 'S5ARSDD3ddZqqqqqb2EUE2h2F1XQHBk7bErRW1WPGe4'

beforeAll(setupTestEnvironment)

describe('Solana executor test', async () => {
  it(
    'Solana should work',
    async () => {
      try {
        const toToken = findDefaultToken(CoinKey.USDC, toChain)
        const request = {
          fromChain,
          toChain,
          fromToken: findDefaultToken(CoinKey.USDC, fromChain).address,
          toToken: toToken.address,
          fromAmount: '300000',
          fromAddress: devSolanaWallet,
          toAddress: devEvmWallet,
          fromAmountForGas: '10000000000000000',
        }
        const quoteResponse = await getQuote(request)

        const privateKey = '' // REMOVE

        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))

        const connection = await getSolanaConnection()
        const decodedTx = Uint8Array.from(
          atob(quoteResponse.transactionRequest!.data!),
          (c) => c.charCodeAt(0)
        )

        const deserializedTx = VersionedTransaction.deserialize(decodedTx)

        deserializedTx.sign([keypair])
        const txid = await connection.sendTransaction(deserializedTx, {
          maxRetries: 5,
          skipPreflight: true,
        })

        await connection.confirmTransaction(
          {
            signature: txid,
          } as BlockheightBasedTransactionConfirmationStrategy,
          'confirmed'
        )
      } catch (error) {
        throw error
      }
    },
    { timeout: 100000 }
  )
})
