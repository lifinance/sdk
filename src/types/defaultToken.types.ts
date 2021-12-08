import {
  ChainId,
  ChainKey,
  CoinKey,
  findDefaultCoinOnChain,
  Token,
} from '@lifinance/types'

export const defaultTokens: { [ChainKey: string]: Array<Token> } = {
  [ChainKey.ETH]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.ETH),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.ETH),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.ETH),
    findDefaultCoinOnChain(CoinKey.MATIC, ChainId.ETH),
  ],
  [ChainKey.BSC]: [
    findDefaultCoinOnChain(CoinKey.BNB, ChainId.BSC),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.BSC),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.BSC),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.BSC),
  ],
  [ChainKey.POL]: [
    findDefaultCoinOnChain(CoinKey.MATIC, ChainId.POL),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.POL),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.POL),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.POL),
  ],
  [ChainKey.DAI]: [
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.DAI),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.DAI),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.DAI),
    findDefaultCoinOnChain(CoinKey.MATIC, ChainId.DAI),
  ],
  [ChainKey.FTM]: [
    findDefaultCoinOnChain(CoinKey.FTM, ChainId.FTM),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.FTM),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.FTM),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.FTM),
  ],
  [ChainKey.ARB]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.ARB),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.ARB),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.ARB),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.ARB),
  ],
  [ChainKey.OPT]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.OPT),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.OPT),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.OPT),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.OPT),
  ],
  [ChainKey.ONE]: [
    findDefaultCoinOnChain(CoinKey.ONE, ChainId.ONE),
    findDefaultCoinOnChain(CoinKey.BNB, ChainId.ONE),
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.ONE),
  ],
  [ChainKey.AVA]: [
    findDefaultCoinOnChain(CoinKey.AVAX, ChainId.AVA),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.AVA),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.AVA),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.AVA),
  ],
  [ChainKey.MOR]: [
    findDefaultCoinOnChain(CoinKey.MOVR, ChainId.MOR),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.MOR),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.MOR),
  ],
  [ChainKey.OKT]: [
    findDefaultCoinOnChain(CoinKey.OKT, ChainId.OKT),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.OKT),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.OKT),
  ],
  [ChainKey.HEC]: [
    findDefaultCoinOnChain(CoinKey.HT, ChainId.HEC),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.HEC),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.HEC),
  ],

  // Testnet
  [ChainKey.GOR]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.GOR),
    findDefaultCoinOnChain(CoinKey.TEST, ChainId.GOR),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.GOR),
    // findDefaultCoinOnChain(CoinKey.USDT, ChainId.GOR),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.GOR),
  ],
  [ChainKey.RIN]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.RIN),
    findDefaultCoinOnChain(CoinKey.TEST, ChainId.RIN),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.RIN),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.RIN),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.RIN),
  ],
  [ChainKey.ROP]: [
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.ROP),
    findDefaultCoinOnChain(CoinKey.TEST, ChainId.ROP),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.ROP),
    findDefaultCoinOnChain(CoinKey.USDT, ChainId.ROP),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.ROP),
  ],
  [ChainKey.KOV]: [findDefaultCoinOnChain(CoinKey.ETH, ChainId.KOV)],
  [ChainKey.MUM]: [
    findDefaultCoinOnChain(CoinKey.MATIC, ChainId.MUM),
    findDefaultCoinOnChain(CoinKey.TEST, ChainId.MUM),
    findDefaultCoinOnChain(CoinKey.USDC, ChainId.MUM),
    // findDefaultCoinOnChain(CoinKey.USDT, ChainId.MUM),
    findDefaultCoinOnChain(CoinKey.DAI, ChainId.MUM),
  ],
  [ChainKey.BSCT]: [findDefaultCoinOnChain(CoinKey.BNB, ChainId.BSCT)],
  [ChainKey.ONET]: [
    findDefaultCoinOnChain(CoinKey.ONE, ChainId.ONET),
    findDefaultCoinOnChain(CoinKey.ETH, ChainId.ONET),
    findDefaultCoinOnChain(CoinKey.BNB, ChainId.ONET),
  ],
}
