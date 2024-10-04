import type { Account, Chain, Client, Transport } from 'viem'
import {
  type GetBlockCountReturnType,
  getBlockCount,
} from '../actions/getBlockCount.js'
import {
  type GetUTXOTransactionParameters,
  type GetUTXOTransactionReturnType,
  getUTXOTransaction,
} from '../actions/getUTXOTransaction.js'
import {
  type SendUTXOTransactionParameters,
  type SendUTXOTransactionReturnType,
  sendUTXOTransaction,
} from '../actions/sendUTXOTransaction.js'

export type UTXOActions = {
  getBlockCount: () => Promise<GetBlockCountReturnType>
  sendUTXOTransaction: (
    args: SendUTXOTransactionParameters
  ) => Promise<SendUTXOTransactionReturnType>
  getUTXOTransaction: (
    args: GetUTXOTransactionParameters
  ) => Promise<GetUTXOTransactionReturnType>
}

export function UTXOActions<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
>(client: Client<transport, chain, account>): UTXOActions {
  return {
    getBlockCount: () => getBlockCount(client),
    sendUTXOTransaction: (args) => sendUTXOTransaction(client, args),
    getUTXOTransaction: (args) => getUTXOTransaction(client, args),
  }
}
