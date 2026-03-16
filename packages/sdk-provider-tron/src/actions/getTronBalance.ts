import type { SDKClient, Token, TokenAmount } from '@lifi/sdk'
import { withDedupe } from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../rpc/callTronRpcsWithRetry.js'
import { isZeroAddress } from '../utils/isZeroAddress.js'

export const getTronBalance = async (
  client: SDKClient,
  walletAddress: string,
  tokens: Token[]
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

  return getTronBalanceDefault(client, tokens, walletAddress)
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
      return {
        ...token,
        blockNumber,
      }
    }
    return {
      ...token,
      amount: result.value,
      blockNumber,
    }
  })

  return tokenAmounts
}
