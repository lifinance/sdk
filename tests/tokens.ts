import type { Coin, StaticToken } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'

type BasicToken = {
  address: string
  decimals: number
  name?: string
  symbol?: string
}

type BasicCoin = {
  key: CoinKey
  name: string
  logoURI: string
  verified: boolean
  chains: {
    [key: number]: BasicToken
  }
}

export const basicCoins: BasicCoin[] = [
  // NATIVE COINS
  // > ETH
  {
    key: CoinKey.ETH,
    name: CoinKey.ETH,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
    verified: true,
    chains: {
      [ChainId.ETH]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.BSC]: {
        address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
        decimals: 18,
      },
      [ChainId.SOL]: {
        address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
        decimals: 8,
        name: 'Wrapped SOL (Wormhole)',
      },
      [ChainId.POL]: {
        address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
        decimals: 18,
      },
      [ChainId.DAI]: {
        address: '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether',
      },
      [ChainId.OPT]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.ARB]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.ERA]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.PZE]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.FTM]: {
        address: '0x74b23882a30290451a17c44f4f05243b6b58c76d',
        decimals: 18,
      },
      [ChainId.ONE]: {
        address: '0x6983d1e6def3690c4d616b13597a09e6193ea013',
        decimals: 18,
      },
      [ChainId.BOB]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.MOO]: {
        address: '0xfa9343c3897324496a05fc75abed6bac29f8a40f',
        decimals: 18,
      },
      [ChainId.AUR]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        symbol: 'AETH',
        name: 'AETH',
      },
      // https://evmexplorer.velas.com/token/0x85219708c49aa701871Ad330A94EA0f41dFf24Ca
      [ChainId.VEL]: {
        address: '0x85219708c49aa701871ad330a94ea0f41dff24ca',
        decimals: 18,
      },
    },
  },
  // > MATIC
  {
    key: CoinKey.MATIC,
    name: CoinKey.MATIC,
    logoURI:
      'https://static.debank.com/image/matic_token/logo_url/matic/6f5a6b6f0732a7a235131bd7804d357c.png',
    verified: true,
    chains: {
      [ChainId.ETH]: {
        address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
        decimals: 18,
        name: 'Matic Token',
      },
      [ChainId.SOL]: {
        address: 'Gz7VkD4MacbEB6yC5XD3HcumEiYx2EtDYYrfikGsvopG',
        decimals: 8,
        name: 'Wrapped Matic (Wormhole)',
      },
      [ChainId.BSC]: {
        address: '0xcc42724c6683b7e57334c4e856f4c9965ed682bd',
        decimals: 18,
        name: 'Matic Token',
      },
      [ChainId.POL]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
      },
      [ChainId.DAI]: {
        address: '0x7122d7661c4564b7c6cd4878b06766489a6028a2',
        decimals: 18,
        name: 'Matic Token',
      },
      // https://evmexplorer.velas.com/token/0x6ab0B8C1a35F9F4Ce107cCBd05049CB1Dbd99Ec5/
      [ChainId.VEL]: {
        address: '0x6ab0b8c1a35f9f4ce107ccbd05049cb1dbd99ec5',
        decimals: 18,
      },
    },
  },
  // > DAI
  {
    key: CoinKey.DAI,
    name: 'DAI Stablecoin',
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
    verified: true,
    chains: {
      [ChainId.ETH]: {
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        decimals: 18,
      },
      [ChainId.SOL]: {
        address: 'EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o',
        decimals: 8,
        name: 'DAI Stablecoin (Wormhole)',
      },
      [ChainId.BSC]: {
        address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
        decimals: 18,
      },
      [ChainId.POL]: {
        address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
        decimals: 18,
        name: '(PoS) DAI Stablecoin',
      },
      [ChainId.DAI]: {
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        symbol: 'xDAI',
        name: 'xDAI Native Token',
      },
      [ChainId.OPT]: {
        address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
        decimals: 18,
      },
      [ChainId.ERA]: {
        address: '0x4bef76b6b7f2823c6c1f4fcfeacd85c24548ad7e',
        decimals: 18,
      },
      [ChainId.FTM]: {
        address: '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e',
        decimals: 18,
      },
      [ChainId.ONE]: {
        address: '0xef977d2f931c1978db5f6747666fa1eacb0d0339',
        decimals: 18,
        symbol: '1DAI',
      },
      [ChainId.AVA]: {
        address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70',
        decimals: 18,
        symbol: 'DAI.e',
      },
      [ChainId.ARB]: {
        address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
        decimals: 18,
      },
      [ChainId.CRO]: {
        address: '0xf2001b145b43032aaf5ee2884e456ccd805f677d',
        decimals: 18,
      },
      [ChainId.FUS]: {
        address: '0x94ba7a27c7a95863d1bdc7645ac2951e0cca06ba',
        decimals: 18,
        name: 'DAI Stablecoin',
      },
      [ChainId.CEL]: {
        address: '0x90ca507a5d4458a4c6c6249d186b6dcb02a5bccd',
        decimals: 18,
      },
      [ChainId.MOO]: {
        address: '0x765277eebeca2e31912c9946eae1021199b39c61',
        decimals: 18,
      },
      [ChainId.BOB]: {
        address: '0xf74195bb8a5cf652411867c5c2c5b8c2a402be35',
        decimals: 18,
      },
      [ChainId.EVM]: {
        address: '0x461d52769884ca6235B685EF2040F47d30C94EB5',
        decimals: 18,
      },
      // https://evmexplorer.velas.com/token/0xE3F5a90F9cb311505cd691a46596599aA1A0AD7D
      [ChainId.VEL]: {
        address: '0xe3f5a90f9cb311505cd691a46596599aa1a0ad7d',
        decimals: 18,
      },
    },
  },
  // OTHER STABLECOINS
  // USDT
  {
    key: CoinKey.USDT,
    name: CoinKey.USDT,
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
    verified: true,
    chains: {
      [ChainId.ETH]: {
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        decimals: 6,
      },
      [ChainId.SOL]: {
        address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        name: 'USDT',
      },
      [ChainId.BSC]: {
        address: '0x55d398326f99059ff775485246999027b3197955',
        decimals: 18,
      },
      [ChainId.POL]: {
        address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
        decimals: 6,
      },
      [ChainId.DAI]: {
        address: '0x4ecaba5870353805a9f068101a40e0f32ed605c6',
        decimals: 6,
      },
      [ChainId.OPT]: {
        address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
        decimals: 6,
      },
      [ChainId.FTM]: {
        address: '0x049d68029688eabf473097a2fc38ef61633a3c7a',
        decimals: 6,
      },
      [ChainId.ARB]: {
        address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
        decimals: 6,
      },
      [ChainId.ONE]: {
        address: '0x3c2b8be99c50593081eaa2a724f0b8285f5aba8f',
        decimals: 6,
      },
      [ChainId.AVA]: {
        address: '0xc7198437980c041c805a1edcba50c1ce5db95118',
        decimals: 6,
        symbol: 'USDT.e',
        name: 'Tether USD',
      },
      [ChainId.MOR]: {
        address: '0xb44a9b6905af7c801311e8f4e76932ee959c663c',
        decimals: 6,
      },
      [ChainId.CRO]: {
        address: '0x66e428c3f67a68878562e79a0234c1f83c208770',
        decimals: 6,
      },
      [ChainId.FUS]: {
        address: '0xfadbbf8ce7d5b7041be672561bba99f79c532e10',
        decimals: 6,
      },
      [ChainId.CEL]: {
        address: '0x88eec49252c8cbc039dcdb394c0c2ba2f1637ea0',
        decimals: 6,
      },
      [ChainId.MOO]: {
        address: '0xefaeee334f0fd1712f9a8cc375f427d9cdd40d73',
        decimals: 6,
      },
      [ChainId.BOB]: {
        address: '0x5de1677344d3cb0d7d465c10b72a8f60699c062d',
        decimals: 6,
      },
      [ChainId.EVM]: {
        address: '0x7FF4a56B32ee13D7D4D405887E0eA37d61Ed919e',
        decimals: 6,
      },
      [ChainId.AUR]: {
        address: '0x4988a896b1227218e4A686fdE5EabdcAbd91571f',
        decimals: 6,
      },
      // https://evmexplorer.velas.com/token/0x01445C31581c354b7338AC35693AB2001B50b9aE
      [ChainId.VEL]: {
        address: '0x01445c31581c354b7338ac35693ab2001b50b9ae',
        decimals: 6,
        name: 'Multichain USDT',
      },
    },
  },
  // USDC
  {
    key: CoinKey.USDC,
    name: 'USD Coin',
    logoURI:
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    verified: true,
    chains: {
      [ChainId.ETH]: {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
      },
      [ChainId.SOL]: {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        name: 'USD Coin',
      },
      [ChainId.BSC]: {
        address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
        decimals: 18,
      },
      [ChainId.POL]: {
        address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
        decimals: 6,
      },
      [ChainId.DAI]: {
        address: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83',
        decimals: 6,
      },
      [ChainId.OPT]: {
        address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
        decimals: 6,
      },
      [ChainId.ERA]: {
        address: '0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4',
        decimals: 6,
      },
      [ChainId.PZE]: {
        address: '0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035',
        decimals: 6,
      },
      [ChainId.FTM]: {
        address: '0x04068da6c83afcfa0e13ba15a6696662335d5b75',
        decimals: 6,
      },
      [ChainId.ARB]: {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
      },
      [ChainId.ONE]: {
        address: '0x985458e523db3d53125813ed68c274899e9dfab4',
        decimals: 6,
      },
      [ChainId.AVA]: {
        address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
        decimals: 6,
      },
      [ChainId.MOR]: {
        address: '0xe3f5a90f9cb311505cd691a46596599aa1a0ad7d',
        decimals: 6,
      },
      [ChainId.CRO]: {
        address: '0xc21223249ca28397b4b6541dffaecc539bff0c59',
        decimals: 6,
      },
      [ChainId.FUS]: {
        address: '0x620fd5fa44be6af63715ef4e65ddfa0387ad13f5',
        decimals: 6,
      },
      [ChainId.CEL]: {
        address: '0xef4229c8c3250c675f21bcefa42f58efbff6002a',
        decimals: 6,
      },
      [ChainId.MOO]: {
        address: '0x818ec0a7fe18ff94269904fced6ae3dae6d6dc0b',
        decimals: 6,
      },
      [ChainId.BOB]: {
        address: '0x66a2a913e447d6b4bf33efbec43aaef87890fbbc',
        decimals: 6,
      },
      [ChainId.EVM]: {
        address: '0x51e44FfaD5C2B122C8b635671FCC8139dc636E82',
        decimals: 6,
      },
      [ChainId.AUR]: {
        address: '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802',
        decimals: 6,
      },
      // https://evmexplorer.velas.com/token/0xe2C120f188eBd5389F71Cf4d9C16d05b62A58993
      [ChainId.VEL]: {
        address: '0xe2c120f188ebd5389f71cf4d9c16d05b62a58993',
        decimals: 6,
        name: 'Multichain USDC',
      },
    },
  },
  // > Solana
  {
    key: CoinKey.SOL,
    name: CoinKey.SOL,
    logoURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    verified: true,
    chains: {
      [ChainId.SOL]: {
        address: 'So11111111111111111111111111111111111111112',
        decimals: 9,
        name: 'Wrapped SOL',
      },
      [ChainId.ETH]: {
        address: '0xD31a59c85aE9D8edEFeC411D448f90841571b89c',
        decimals: 9,
        name: 'Wrapped SOL (Wormhole)',
      },
      [ChainId.POL]: {
        address: '0xd93f7E271cB87c23AaA73edC008A79646d1F9912',
        decimals: 9,
        name: 'Wrapped SOL (Wormhole)',
      },
      [ChainId.FTM]: {
        address: '0xd99021C2A33e4Cf243010539c9e9b7c52E0236c1',
        decimals: 9,
        name: 'Token Wrapped SOL (Wormhole)',
      },
      [ChainId.AVA]: {
        address: '0xFE6B19286885a4F7F55AdAD09C3Cd1f906D2478F',
        decimals: 9,
        symbol: 'WSOL',
        name: 'Wrapped SOL (Wormhole)',
      },
      [ChainId.AUR]: {
        address: '0x3370C8961A1697F22B49c99669C1d98fE63d031D',
        decimals: 9,
        symbol: 'WSOL',
        name: 'Token Wrapped SOL (Wormhole)',
      },
      [ChainId.CEL]: {
        address: '0x4581E64115d46CcdeE65Be2336bEc86c9BA54C01',
        decimals: 9,
        symbol: 'WSOL',
        name: 'Token Wrapped SOL (Wormhole)',
      },
    },
  },
]

export const defaultCoins: Array<Coin> = basicCoins.map((coin) => {
  const defaultCoin: Coin = {
    key: coin.key,
    name: coin.name,
    logoURI: coin.logoURI,
    verified: coin.verified,
    chains: {},
  }

  for (const [chainId, token] of Object.entries(coin.chains)) {
    defaultCoin.chains[chainId] = {
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol ?? coin.key,
      chainId: Number.parseInt(chainId), // Object.entries, Object.keys etc. only return keys as strings. Therefore, we have to parse them here
      coinKey: coin.key,
      name: token.name ?? coin.name ?? coin.key,
      logoURI: coin.logoURI,
    }
  }

  return defaultCoin
})

export const findDefaultCoin = (coinKey: CoinKey): Coin => {
  const coin = defaultCoins.find((coin) => coin.key === coinKey)
  if (!coin) {
    throw new Error('Invalid Coin')
  }
  return coin
}
export const findDefaultToken = (
  coinKey: CoinKey,
  chainId: ChainId
): StaticToken => {
  const coin = findDefaultCoin(coinKey)
  const token = coin.chains[chainId]
  if (!token) {
    throw new Error(`Invalid chain ${chainId} to coin ${coinKey}`)
  }
  return token
}
