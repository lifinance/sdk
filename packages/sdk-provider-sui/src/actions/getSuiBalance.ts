import {
  ChainId,
  type SDKClient,
  type Token,
  type TokenAmount,
  withDedupe,
} from '@lifi/sdk'
import type { SuiClientTypes } from '@mysten/sui/client'
import { callSuiWithRetry } from '../client/suiClient.js'
import { SuiTokenLongAddress, SuiTokenShortAddress } from '../types.js'

export async function getSuiBalance(
  client: SDKClient,
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> {
  if (tokens.length === 0) {
    return []
  }

  const { chainId } = tokens[0]
  for (const token of tokens) {
    if (token.chainId !== chainId) {
      console.warn('Requested tokens have to be on the same chain.')
    }
  }

  return getSuiBalanceDefault(client, chainId, tokens, walletAddress)
}

const getSuiBalanceDefault = async (
  client: SDKClient,
  _chainId: number,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  // The dedupe ids carry the RPC URLs of this SDK client. Two SDK clients
  // with different URLs (one per tenant, each with its own API key) must not
  // share a request. The lookup runs inside each settled entry, so a failed
  // lookup leaves the amounts undefined, as a failed request does.
  const rpcUrlsKey = client
    .getRpcUrlsByChainId(ChainId.SUI)
    .then((rpcUrls) => rpcUrls.join(' '))
  const [coins, checkpoint] = await Promise.allSettled([
    rpcUrlsKey.then((urlsKey) =>
      withDedupe(
        () =>
          callSuiWithRetry(client, async (suiClient) => {
            // listBalances is paginated; page through to collect every coin type.
            const balances: SuiClientTypes.Balance[] = []
            let cursor: string | null | undefined
            do {
              const page = await suiClient.core.listBalances({
                owner: walletAddress,
                cursor,
              })
              balances.push(...page.balances)
              cursor = page.hasNextPage ? page.cursor : null
            } while (cursor)
            return balances
          }),
        {
          id: `${getSuiBalanceDefault.name}.listBalances.${walletAddress}.${urlsKey}`,
        }
      )
    ),
    rpcUrlsKey.then((urlsKey) =>
      withDedupe(
        () =>
          callSuiWithRetry(client, async (suiClient) => {
            const { response } = await suiClient.ledgerService.getServiceInfo(
              {}
            )
            return response.checkpointHeight ?? 0n
          }),
        { id: `${getSuiBalanceDefault.name}.getServiceInfo.${urlsKey}` }
      )
    ),
  ])

  const coinsOk = coins.status === 'fulfilled'
  const coinsResult = coinsOk ? coins.value : []
  const blockNumber = checkpoint.status === 'fulfilled' ? checkpoint.value : 0n

  const walletTokenAmounts = coinsResult.reduce(
    (tokenAmounts, coin) => {
      const amount = BigInt(coin.balance)
      if (amount > 0n) {
        tokenAmounts[coin.coinType] = amount
      }
      return tokenAmounts
    },
    {} as Record<string, bigint>
  )

  // The native SUI coin type can be returned in short (`0x2::sui::SUI`) or
  // fully-normalized (`0x0000…0002::sui::SUI`) form depending on the RPC.
  // Map both so token lists using either format resolve.
  const suiTokenBalance = coinsResult.find(
    (coin) =>
      coin.coinType === SuiTokenShortAddress ||
      coin.coinType === SuiTokenLongAddress
  )
  if (suiTokenBalance?.balance) {
    const suiAmount = BigInt(suiTokenBalance.balance)
    walletTokenAmounts[SuiTokenShortAddress] = suiAmount
    walletTokenAmounts[SuiTokenLongAddress] = suiAmount
  }

  const tokenAmounts: TokenAmount[] = tokens.map((token) => {
    const found = walletTokenAmounts[token.address]
    if (found !== undefined) {
      return { ...token, amount: found, blockNumber }
    }
    if (coinsOk) {
      // Wallet genuinely has no coins of this type.
      return { ...token, amount: 0n, blockNumber }
    }
    // RPC failed — leave amount undefined.
    return { ...token, blockNumber }
  })
  return tokenAmounts
}
