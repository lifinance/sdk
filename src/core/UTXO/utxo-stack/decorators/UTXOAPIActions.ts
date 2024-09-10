/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Account, Chain, Client, Transport } from 'viem'
import {
  getBalance,
  type GetBalanceParameters,
  type GetBalanceReturnType,
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
