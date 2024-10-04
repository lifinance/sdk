import type { Account, Chain, Client, Transport } from 'viem'
import {
  type GetBalanceParameters,
  type GetBalanceReturnType,
  getBalance,
} from '../actions/getBalance.js'

export type UTXOAPIActions = {
  getBalance: (args: GetBalanceParameters) => Promise<GetBalanceReturnType>
}

export function UTXOAPIActions<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
>(client: Client<transport, chain, account>): UTXOAPIActions {
  return {
    getBalance: (args) => getBalance(client, args),
  }
}
