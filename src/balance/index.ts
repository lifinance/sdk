export * from './checkBalance'
export * from './getTokenBalance'
import { checkBalance } from './checkBalance'
import {
  getTokenBalance,
  getTokenBalances,
  getTokenBalancesForChains,
} from './getTokenBalance'

export default {
  checkBalance,
  getTokenBalance,
  getTokenBalances,
  getTokenBalancesForChains,
}
