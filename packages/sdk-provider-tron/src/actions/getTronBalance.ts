import type { SDKClient, Token, TokenAmount } from '@lifi/sdk'
import { withDedupe } from '@lifi/sdk'
import { TronWeb } from 'tronweb'

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
  const rpcUrls = await client.getRpcUrlsByChainId(tokens[0].chainId)
  const fullHost = rpcUrls[0] || 'https://api.trongrid.io'

  const tronWeb = new TronWeb({ fullHost })

  const [trxBalance, currentBlock] = await Promise.allSettled([
    withDedupe(() => tronWeb.trx.getBalance(walletAddress), {
      id: `${getTronBalanceDefault.name}.getBalance`,
    }),
    withDedupe(() => tronWeb.trx.getCurrentBlock(), {
      id: `${getTronBalanceDefault.name}.getCurrentBlock`,
    }),
  ])

  const nativeBalance =
    trxBalance.status === 'fulfilled' ? BigInt(trxBalance.value) : 0n
  const blockNumber =
    currentBlock.status === 'fulfilled'
      ? BigInt(currentBlock.value.block_header?.raw_data?.number ?? 0)
      : 0n

  const walletTokenAmounts: Record<string, bigint> = {}

  // Identify native TRX tokens by checking for the zero address pattern
  const nativeTokens = tokens.filter(
    (token) =>
      token.address === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' ||
      token.address === '0x0000000000000000000000000000000000000000'
  )
  const trc20Tokens = tokens.filter(
    (token) =>
      token.address !== 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' &&
      token.address !== '0x0000000000000000000000000000000000000000'
  )

  for (const token of nativeTokens) {
    walletTokenAmounts[token.address] = nativeBalance
  }

  if (trc20Tokens.length > 0) {
    const trc20Balances = await Promise.allSettled(
      trc20Tokens.map((token) =>
        withDedupe(
          async () => {
            const contract = await tronWeb.contract().at(token.address)
            const balance = await contract.balanceOf(walletAddress).call()
            return {
              address: token.address,
              balance: BigInt(balance.toString()),
            }
          },
          {
            id: `${getTronBalanceDefault.name}.balanceOf.${token.address}`,
          }
        )
      )
    )

    for (const result of trc20Balances) {
      if (result.status === 'fulfilled' && result.value.balance > 0n) {
        walletTokenAmounts[result.value.address] = result.value.balance
      }
    }
  }

  const tokenAmounts: TokenAmount[] = tokens.map((token) => {
    if (walletTokenAmounts[token.address]) {
      return {
        ...token,
        amount: walletTokenAmounts[token.address],
        blockNumber,
      }
    }
    return {
      ...token,
      blockNumber,
    }
  })

  return tokenAmounts
}
