import type { SDKClient, Token, TokenAmount } from '@lifi/sdk'
import { withDedupe } from '@lifi/sdk'
import { TronWeb } from 'tronweb'
import { callTronRpcsWithRetry } from '../rpc/callTronRpcsWithRetry.js'
import { encodeAddressCalldata, toEvmHex } from '../utils/address.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'
import { multicall3Abi } from '../utils/multicall3Abi.js'
import { getMulticallAddress } from './getMulticallAddress.js'

const BALANCE_OF_SELECTOR = TronWeb.sha3('balanceOf(address)').slice(2, 10)
const GET_ETH_BALANCE_SELECTOR = TronWeb.sha3('getEthBalance(address)').slice(
  2,
  10
)

const DEFAULT_MULTICALL_BATCH_SIZE = 50

export const getTronBalance = async (
  client: SDKClient,
  walletAddress: string,
  tokens: Token[],
  multicallBatchSize: number = DEFAULT_MULTICALL_BATCH_SIZE
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  for (const token of tokens) {
    if (token.chainId !== chainId) {
      console.warn('Requested tokens have to be on the same chain.')
    }
  }

  const multicallAddress = await getMulticallAddress(client, chainId)

  if (multicallAddress && tokens.length > 1) {
    return getTronBalanceMulticall(
      client,
      tokens,
      walletAddress,
      multicallAddress,
      multicallBatchSize
    )
  }

  return getTronBalanceDefault(client, tokens, walletAddress)
}

const getTronBalanceMulticall = async (
  client: SDKClient,
  tokens: Token[],
  walletAddress: string,
  multicallAddress: string,
  batchSize: number
): Promise<TokenAmount[]> => {
  const walletHex = toEvmHex(walletAddress)
  const multicallHex = toEvmHex(multicallAddress)

  const [blockNumber, results] = await callTronRpcsWithRetry(
    client,
    async (tronWeb) => {
      const contract = tronWeb.contract(multicall3Abi, multicallAddress)

      // TronWeb encodes tuples positionally: [target, allowFailure, callData]
      const allCalls = tokens.map((token) => {
        const isNative = isZeroAddress(token.address)
        return [
          isNative ? multicallHex : toEvmHex(token.address),
          true,
          encodeAddressCalldata(
            isNative ? GET_ETH_BALANCE_SELECTOR : BALANCE_OF_SELECTOR,
            walletHex
          ),
        ]
      })

      // Chunk calls to avoid CPU timeout on Tron nodes
      const batches: (typeof allCalls)[] = []
      for (let i = 0; i < allCalls.length; i += batchSize) {
        batches.push(allCalls.slice(i, i + batchSize))
      }

      const [block, ...batchResults] = await Promise.all([
        tronWeb.trx.getCurrentBlock(),
        ...batches.map((batch, idx) =>
          contract
            .aggregate3(batch)
            .call({ from: walletAddress })
            // TronWeb wraps the single return value in an extra array
            .then((r: unknown[]) => r[0] as Array<[boolean, string]>)
            .catch((error: Error) => {
              console.warn(
                `[getTronBalance] batch ${idx + 1}/${batches.length} failed:`,
                error.message
              )
              return batch.map(() => [false, '0x'] as [boolean, string])
            })
        ),
      ])

      return [
        BigInt(block.block_header?.raw_data?.number ?? 0),
        batchResults.flat(),
      ]
    }
  )

  return tokens.map((token, i) => {
    const [success, returnData] = results[i] as [boolean, string]
    if (!success) {
      return { ...token, blockNumber }
    }
    return { ...token, amount: BigInt(returnData), blockNumber }
  })
}

const getTronBalanceDefault = async (
  client: SDKClient,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  const [blockNumber, results] = await callTronRpcsWithRetry(
    client,
    async (tronWeb) => {
      const host = tronWeb.fullNode.host
      const queue: Promise<bigint>[] = tokens.map((token) => {
        if (isZeroAddress(token.address)) {
          return withDedupe(
            async () => BigInt(await tronWeb.trx.getBalance(walletAddress)),
            { id: `${getTronBalanceDefault.name}.getBalance.${host}` }
          )
        }
        return withDedupe(
          async () => {
            const contract = await tronWeb.contract().at(token.address)
            const balance = await contract
              .balanceOf(walletAddress)
              .call({ from: walletAddress })
            return BigInt(balance.toString())
          },
          {
            id: `${getTronBalanceDefault.name}.balanceOf.${token.address}.${host}`,
          }
        )
      })

      return Promise.all([
        withDedupe(
          async () => {
            const block = await tronWeb.trx.getCurrentBlock()
            return BigInt(block.block_header?.raw_data?.number ?? 0)
          },
          { id: `${getTronBalanceDefault.name}.getCurrentBlock.${host}` }
        ),
        Promise.allSettled(queue),
      ])
    }
  )

  const tokenAmounts: TokenAmount[] = tokens.map((token, index) => {
    const result = results[index]
    if (result.status === 'rejected') {
      return { ...token, blockNumber }
    }
    return { ...token, amount: result.value, blockNumber }
  })

  return tokenAmounts
}
